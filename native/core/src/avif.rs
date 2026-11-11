//! Still AVIF images. avif-parse reads the container and rav1d decodes the
//! AV1 data; this converts the result to RGBA8 with straight alpha. The colour
//! profile and the rotation and mirroring are read from the container here,
//! since avif-parse doesn't report them. Animated and grid images are refused
//! as unsupported (avif-parse does this).

use crate::image::DecodeError;
use image::{DynamicImage, RgbaImage};
use rav1d::include::dav1d::data::Dav1dData;
use rav1d::include::dav1d::dav1d::{Dav1dContext, Dav1dSettings};
use rav1d::include::dav1d::headers::{
    Dav1dSequenceHeader, DAV1D_MC_BT2020_CL, DAV1D_MC_BT2020_NCL, DAV1D_MC_BT709, DAV1D_MC_IDENTITY,
    DAV1D_PIXEL_LAYOUT_I400, DAV1D_PIXEL_LAYOUT_I420, DAV1D_PIXEL_LAYOUT_I422,
};
use rav1d::include::dav1d::picture::Dav1dPicture;
use rav1d::src::lib::{
    dav1d_close, dav1d_data_create, dav1d_data_unref, dav1d_default_settings, dav1d_get_picture, dav1d_open,
    dav1d_picture_unref, dav1d_send_data,
};
use rav1d::Dav1dResult;
use std::marker::PhantomData;
use std::mem::MaybeUninit;
use std::ptr::{self, NonNull};

/// Larger pictures are refused: 512 MiB of RGBA, the `image` crate's
/// default allocation limit.
const MAX_PIXELS: u64 = 1 << 27;

/// The picture, upright, and its ICC profile if it has one.
pub fn decode(data: &[u8]) -> Result<(DynamicImage, Option<Vec<u8>>), DecodeError> {
    let avif = avif_parse::read_avif(&mut &data[..]).map_err(|error| match error {
        avif_parse::Error::Unsupported(_) => DecodeError::Unsupported,
        _ => DecodeError::Decode,
    })?;
    let properties = Properties::read(data).unwrap_or_default();
    let color = Av1Picture::decode(&avif.primary_item)?;
    let alpha = match &avif.alpha_item {
        Some(item) => Some(Av1Picture::decode(item)?),
        None => None,
    };
    let rgba = to_rgba(&color, alpha.as_ref(), properties.nclx, avif.premultiplied_alpha)?;
    let mut picture = DynamicImage::ImageRgba8(rgba);
    for transform in properties.transforms {
        picture = match transform {
            // irot turns anti-clockwise; imir's axis 0 swaps top and bottom
            // (ISO/IEC 23008-12:2022; libheif and libavif agree).
            Transform::Rotate(1) => picture.rotate270(),
            Transform::Rotate(2) => picture.rotate180(),
            Transform::Rotate(3) => picture.rotate90(),
            Transform::Mirror(0) => picture.flipv(),
            Transform::Mirror(_) => picture.fliph(),
            Transform::Rotate(_) => picture,
        };
    }
    Ok((picture, properties.icc))
}

/// A decoded AV1 picture, held until dropped.
struct Av1Picture {
    picture: Dav1dPicture,
    context: Option<Dav1dContext>,
}

/// rav1d decodes on its own worker threads. A panic there can't reach the
/// caller's catch_unwind and would leave the call waiting forever, so it
/// aborts the process instead.
fn abort_on_worker_panic() {
    static HOOK: std::sync::Once = std::sync::Once::new();
    HOOK.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            previous(info);
            if std::thread::current().name().is_some_and(|name| name.starts_with("rav1d-worker")) {
                std::process::abort();
            }
        }));
    });
}

impl Av1Picture {
    fn decode(data: &[u8]) -> Result<Av1Picture, DecodeError> {
        if data.is_empty() {
            return Err(DecodeError::Decode);
        }
        abort_on_worker_panic();
        let mut decoded = Av1Picture {
            picture: Dav1dPicture::default(),
            context: None,
        };
        // SAFETY: the settings are written by dav1d_default_settings before
        // they are read, the context and picture live in `decoded`, which
        // releases them, and `input` is released below on every path.
        unsafe {
            let mut settings = MaybeUninit::<Dav1dSettings>::uninit();
            dav1d_default_settings(NonNull::new_unchecked(settings.as_mut_ptr()));
            let mut settings = settings.assume_init();
            // rav1d 1.1.0 panics on a decode error when it has a single
            // frame context, so it always gets two: at least two threads
            // and a frame delay of two.
            let threads = std::thread::available_parallelism().map_or(2, |count| count.get());
            settings.n_threads = threads.clamp(2, 256) as i32;
            settings.max_frame_delay = 2;
            settings.all_layers = 0;
            settings.frame_size_limit = MAX_PIXELS as u32;
            // A logger with no callback (all zero) keeps rav1d off stderr.
            settings.logger = std::mem::zeroed();
            check(dav1d_open(
                Some(NonNull::from(&mut decoded.context)),
                Some(NonNull::from(&mut settings)),
            ))?;
            let context = decoded.context.ok_or(DecodeError::Decode)?;

            let mut input = Dav1dData::default();
            let buffer = dav1d_data_create(Some(NonNull::from(&mut input)), data.len());
            if buffer.is_null() {
                return Err(DecodeError::Decode);
            }
            ptr::copy_nonoverlapping(data.as_ptr(), buffer, data.len());
            // rav1d takes all the data at once. The first ask for the picture
            // can come back empty while frame threads work; the next waits
            // for them.
            let sent = dav1d_send_data(Some(context), Some(NonNull::from(&mut input)));
            let mut result = Err(DecodeError::Decode);
            if sent.0 >= 0 {
                for _ in 0..3 {
                    let got = dav1d_get_picture(Some(context), Some(NonNull::from(&mut decoded.picture)));
                    if got.0 == 0 {
                        result = Ok(());
                        break;
                    }
                    if !again(got) {
                        break;
                    }
                }
            }
            dav1d_data_unref(Some(NonNull::from(&mut input)));
            result?;
        }
        Ok(decoded)
    }

    fn size(&self) -> Result<(usize, usize), DecodeError> {
        let (width, height) = (self.picture.p.w, self.picture.p.h);
        if width <= 0 || height <= 0 || width as u64 * height as u64 > MAX_PIXELS {
            return Err(DecodeError::Decode);
        }
        Ok((width as usize, height as usize))
    }

    fn bits(&self) -> Result<u32, DecodeError> {
        match self.picture.p.bpc {
            bits @ (8 | 10 | 12) => Ok(bits as u32),
            _ => Err(DecodeError::Decode),
        }
    }

    fn header(&self) -> Result<&Dav1dSequenceHeader, DecodeError> {
        let header = self.picture.seq_hdr.ok_or(DecodeError::Decode)?;
        // SAFETY: the header belongs to the picture and lives as long as it.
        Ok(unsafe { header.as_ref() })
    }

    /// Plane `index` (0 is luma), `width` by `height` samples, read as
    /// `sample * scale + offset`.
    fn plane(&self, index: usize, width: usize, height: usize, range: (f32, f32)) -> Result<Plane<'_>, DecodeError> {
        let data = self.picture.data[index].ok_or(DecodeError::Decode)?;
        let wide = self.bits()? > 8;
        let stride = self.picture.stride[index.min(1)];
        let row = width.checked_mul(if wide { 2 } else { 1 }).ok_or(DecodeError::Decode)?;
        if stride <= 0 || (stride as usize) < row {
            return Err(DecodeError::Decode);
        }
        Ok(Plane {
            data: data.as_ptr() as *const u8,
            stride: stride as usize,
            width,
            height,
            wide,
            scale: range.0,
            offset: range.1,
            picture: PhantomData,
        })
    }
}

impl Drop for Av1Picture {
    fn drop(&mut self) {
        // SAFETY: both come from rav1d and are released once, here.
        unsafe {
            dav1d_picture_unref(Some(NonNull::from(&mut self.picture)));
            dav1d_close(Some(NonNull::from(&mut self.context)));
        }
    }
}

fn check(result: Dav1dResult) -> Result<(), DecodeError> {
    if result.0 < 0 {
        return Err(DecodeError::Decode);
    }
    Ok(())
}

/// rav1d's EAGAIN: it wants the other call (send or get) first.
fn again(result: Dav1dResult) -> bool {
    std::io::Error::from_raw_os_error(-result.0).kind() == std::io::ErrorKind::WouldBlock
}

/// One plane of a decoded picture, read a row at a time.
struct Plane<'a> {
    data: *const u8,
    stride: usize,
    width: usize,
    height: usize,
    wide: bool,
    scale: f32,
    offset: f32,
    picture: PhantomData<&'a Av1Picture>,
}

impl Plane<'_> {
    fn read(&self, y: usize, out: &mut [f32]) {
        let y = y.min(self.height - 1);
        let length = if self.wide { self.width * 2 } else { self.width };
        // SAFETY: rav1d allocates `height` rows of `stride` bytes, and the
        // stride was checked against the row length.
        let row = unsafe { std::slice::from_raw_parts(self.data.add(y * self.stride), length) };
        if self.wide {
            for (value, sample) in out.iter_mut().zip(row.chunks_exact(2)) {
                *value = u16::from_ne_bytes([sample[0], sample[1]]) as f32 * self.scale + self.offset;
            }
        } else {
            for (value, &sample) in out.iter_mut().zip(row) {
                *value = sample as f32 * self.scale + self.offset;
            }
        }
    }
}

/// Scale and offset that take a luma (or alpha) sample to 0-1.
fn luma_range(bits: u32, full: bool) -> (f32, f32) {
    let unit = (1u32 << (bits - 8)) as f32;
    if full {
        (1.0 / ((1u32 << bits) - 1) as f32, 0.0)
    } else {
        (1.0 / (219.0 * unit), -16.0 / 219.0)
    }
}

/// Scale and offset that take a chroma sample to -0.5-0.5.
fn chroma_range(bits: u32, full: bool) -> (f32, f32) {
    let unit = (1u32 << (bits - 8)) as f32;
    if full {
        let max = ((1u32 << bits) - 1) as f32;
        (1.0 / max, -128.0 * unit / max)
    } else {
        (1.0 / (224.0 * unit), -128.0 / 224.0)
    }
}

enum Matrix {
    Identity,
    Ycc { kr: f32, kb: f32 },
}

impl Matrix {
    /// BT.601 when unspecified, and for the matrices not handled here.
    fn new(coefficients: u32) -> Matrix {
        match coefficients {
            DAV1D_MC_IDENTITY => Matrix::Identity,
            DAV1D_MC_BT709 => Matrix::Ycc { kr: 0.2126, kb: 0.0722 },
            DAV1D_MC_BT2020_NCL | DAV1D_MC_BT2020_CL => Matrix::Ycc { kr: 0.2627, kb: 0.0593 },
            _ => Matrix::Ycc { kr: 0.299, kb: 0.114 },
        }
    }
}

/// Converts the colour and alpha pictures to RGBA8 with straight alpha.
/// Primaries and transfer are ignored: without an ICC profile the result is
/// taken as sRGB.
fn to_rgba(
    color: &Av1Picture,
    alpha: Option<&Av1Picture>,
    nclx: Option<(u16, bool)>,
    premultiplied: bool,
) -> Result<RgbaImage, DecodeError> {
    let (width, height) = color.size()?;
    let header = color.header()?;
    let (coefficients, full) = match nclx {
        Some((coefficients, full)) => (u32::from(coefficients), full),
        None => (header.mtrx, header.color_range != 0),
    };
    let matrix = Matrix::new(coefficients);
    let bits = color.bits()?;
    let luma = luma_range(bits, full);
    let chroma = match matrix {
        Matrix::Identity => luma,
        Matrix::Ycc { .. } => chroma_range(bits, full),
    };

    let y_plane = color.plane(0, width, height, luma)?;
    let chroma = match color.picture.p.layout {
        DAV1D_PIXEL_LAYOUT_I400 => None,
        layout => {
            let horizontal = layout == DAV1D_PIXEL_LAYOUT_I420 || layout == DAV1D_PIXEL_LAYOUT_I422;
            let vertical = layout == DAV1D_PIXEL_LAYOUT_I420;
            let chroma_width = (width + horizontal as usize) >> horizontal as usize;
            let chroma_height = (height + vertical as usize) >> vertical as usize;
            let u = color.plane(1, chroma_width, chroma_height, chroma)?;
            let v = color.plane(2, chroma_width, chroma_height, chroma)?;
            Some((u, v, horizontal, vertical))
        }
    };
    let a_plane = match alpha {
        Some(alpha) => {
            if alpha.size()? != (width, height) {
                return Err(DecodeError::Decode);
            }
            let range = luma_range(alpha.bits()?, alpha.header()?.color_range != 0);
            Some(alpha.plane(0, width, height, range)?)
        }
        None => None,
    };

    let length = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or(DecodeError::Decode)?;
    let mut rgba = Vec::new();
    rgba.try_reserve_exact(length).map_err(|_| DecodeError::Decode)?;
    let mut y_row = vec![0.0; width];
    let mut u_row = vec![0.0; width];
    let mut v_row = vec![0.0; width];
    let mut a_row = vec![1.0; width];
    let mut near = vec![0.0; width];
    let mut far = vec![0.0; width];
    for y in 0..height {
        y_plane.read(y, &mut y_row);
        if let Some((u, v, horizontal, vertical)) = &chroma {
            upsample(u, y, *horizontal, *vertical, &mut near, &mut far, &mut u_row);
            upsample(v, y, *horizontal, *vertical, &mut near, &mut far, &mut v_row);
        }
        if let Some(a) = &a_plane {
            a.read(y, &mut a_row);
        }
        for x in 0..width {
            let (luma, a) = (y_row[x], a_row[x].clamp(0.0, 1.0));
            let (mut r, mut g, mut b) = match (&chroma, &matrix) {
                (None, _) => (luma, luma, luma),
                (Some(_), Matrix::Identity) => (v_row[x], luma, u_row[x]),
                (Some(_), &Matrix::Ycc { kr, kb }) => {
                    let r = luma + (2.0 - 2.0 * kr) * v_row[x];
                    let b = luma + (2.0 - 2.0 * kb) * u_row[x];
                    (r, (luma - kr * r - kb * b) / (1.0 - kr - kb), b)
                }
            };
            if premultiplied && a > 0.0 {
                (r, g, b) = (r / a, g / a, b / a);
            }
            rgba.extend_from_slice(&[byte(r), byte(g), byte(b), byte(a)]);
        }
    }
    RgbaImage::from_raw(width as u32, height as u32, rgba).ok_or(DecodeError::Decode)
}

/// Row `y` of a chroma plane at full width. Upsampled bilinearly, with each
/// chroma sample centred between the luma samples it covers.
fn upsample(
    plane: &Plane,
    y: usize,
    horizontal: bool,
    vertical: bool,
    near: &mut [f32],
    far: &mut [f32],
    out: &mut [f32],
) {
    let (near, far) = (&mut near[..plane.width], &mut far[..plane.width]);
    if vertical {
        plane.read(y / 2, near);
        plane.read(neighbour(y, plane.height), far);
        for (near, far) in near.iter_mut().zip(far.iter()) {
            *near = 0.75 * *near + 0.25 * far;
        }
    } else {
        plane.read(y, near);
    }
    if horizontal {
        for (x, value) in out.iter_mut().enumerate() {
            *value = 0.75 * near[x / 2] + 0.25 * near[neighbour(x, plane.width)];
        }
    } else {
        out.copy_from_slice(near);
    }
}

/// The chroma sample on the other side of full-size position `position`.
fn neighbour(position: usize, count: usize) -> usize {
    let index = position / 2;
    if position.is_multiple_of(2) {
        index.saturating_sub(1)
    } else {
        (index + 1).min(count - 1)
    }
}

fn byte(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

/// What the container says about the primary item that avif-parse leaves out.
#[derive(Default)]
struct Properties {
    icc: Option<Vec<u8>>,
    // Matrix coefficients and full range flag from an nclx `colr`.
    nclx: Option<(u16, bool)>,
    // `irot` and `imir`, in the order they apply.
    transforms: Vec<Transform>,
}

enum Transform {
    Rotate(u8),
    Mirror(u8),
}

impl Properties {
    /// None if the boxes can't be read; avif-parse has already accepted the
    /// file, so this only loses colour and orientation.
    fn read(file: &[u8]) -> Option<Properties> {
        let meta = boxes(file).find(|(kind, _)| kind == b"meta")?.1.get(4..)?;
        let pitm = boxes(meta).find(|(kind, _)| kind == b"pitm")?.1;
        let primary = match pitm.first()? {
            0 => u32::from(u16::from_be_bytes(pitm.get(4..6)?.try_into().ok()?)),
            _ => u32::from_be_bytes(pitm.get(4..8)?.try_into().ok()?),
        };
        let iprp = boxes(meta).find(|(kind, _)| kind == b"iprp")?.1;
        let ipco: Vec<_> = boxes(boxes(iprp).find(|(kind, _)| kind == b"ipco")?.1).collect();
        let mut properties = Properties::default();
        for (_, ipma) in boxes(iprp).filter(|(kind, _)| kind == b"ipma") {
            for index in associations(ipma, primary)? {
                let Some(&(kind, body)) = index.checked_sub(1).and_then(|index| ipco.get(index)) else {
                    continue;
                };
                match (&kind, body.get(0..4)) {
                    (b"colr", Some(b"nclx")) => {
                        let matrix = u16::from_be_bytes(body.get(8..10)?.try_into().ok()?);
                        properties.nclx = Some((matrix, body.get(10)? & 0x80 != 0));
                    }
                    (b"colr", Some(b"prof" | b"rICC")) => properties.icc = Some(body[4..].to_vec()),
                    (b"irot", _) => properties.transforms.push(Transform::Rotate(body.first()? & 3)),
                    (b"imir", _) => properties.transforms.push(Transform::Mirror(body.first()? & 1)),
                    _ => {}
                }
            }
        }
        Some(properties)
    }
}

/// The property indices (from 1) an `ipma` box gives `item`, in order.
fn associations(ipma: &[u8], item: u32) -> Option<Vec<usize>> {
    let (version, wide) = (*ipma.first()?, ipma.get(3)? & 1 != 0);
    let mut rest = ipma.get(4..)?;
    let mut take = |count: usize| {
        let (head, tail) = rest.split_at_checked(count)?;
        rest = tail;
        Some(head)
    };
    let entries = u32::from_be_bytes(take(4)?.try_into().ok()?);
    let mut indices = Vec::new();
    for _ in 0..entries {
        let id = match version {
            0 => u32::from(u16::from_be_bytes(take(2)?.try_into().ok()?)),
            _ => u32::from_be_bytes(take(4)?.try_into().ok()?),
        };
        for _ in 0..*take(1)?.first()? {
            let index = if wide {
                usize::from(u16::from_be_bytes(take(2)?.try_into().ok()?) & 0x7fff)
            } else {
                usize::from(take(1)?[0] & 0x7f)
            };
            if id == item {
                indices.push(index);
            }
        }
    }
    Some(indices)
}

/// The boxes in `data`, as (type, contents). Stops at the first box that
/// doesn't fit.
fn boxes(mut data: &[u8]) -> impl Iterator<Item = ([u8; 4], &[u8])> {
    std::iter::from_fn(move || {
        let size = u32::from_be_bytes(data.get(0..4)?.try_into().ok()?);
        let kind: [u8; 4] = data.get(4..8)?.try_into().ok()?;
        let (header, size) = match size {
            0 => (8, data.len()),
            1 => (
                16,
                usize::try_from(u64::from_be_bytes(data.get(8..16)?.try_into().ok()?)).ok()?,
            ),
            size => (8, size as usize),
        };
        let body = data.get(header..size)?;
        data = &data[size..];
        Some((kind, body))
    })
}
