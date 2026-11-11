//! Still JPEG XL images, through jxl-oxide. It converts to sRGB itself (with
//! moxcms for embedded ICC profiles; HDR is tone mapped down) and applies the
//! orientation stored in the codestream. Only the first frame of an animation
//! is decoded.

use crate::image::DecodeError;
use image::{DynamicImage, RgbaImage};
use jxl_oxide::{AllocTracker, EnumColourEncoding, JxlImage, JxlThreadPool, RenderingIntent};
use std::borrow::Cow;

/// Larger pictures are refused: 512 MiB of RGBA, as for AVIF.
const MAX_PIXELS: u64 = 1 << 27;

/// What jxl-oxide may allocate per pixel while decoding. Its buffers hold up
/// to five channels of 32 bits, some of them twice; RGBA takes about 40.
const BYTES_PER_PIXEL: usize = 64;

const CONTAINER: &[u8] = b"\0\0\0\x0cJXL \r\n\x87\n";

/// Whether the data starts like a bare JPEG XL codestream or a JPEG XL
/// container.
pub fn is_jxl(data: &[u8]) -> bool {
    data.starts_with(&[0xff, 0x0a]) || data.starts_with(CONTAINER)
}

/// The first frame, upright, as RGBA8 with straight alpha.
pub fn decode(data: &[u8]) -> Result<DynamicImage, DecodeError> {
    let codestream = codestream(data).ok_or(DecodeError::Decode)?;
    // Enough for the compressed data while reading it; raised for the
    // picture once its size is known.
    let tracker = AllocTracker::with_limit(codestream.len());
    let mut image = JxlImage::builder()
        .pool(JxlThreadPool::none())
        .alloc_tracker(tracker.clone())
        .read(&codestream[..])
        .map_err(|_| DecodeError::Decode)?;
    let (width, height) = (image.width(), image.height());
    if too_large(width, height) || image.num_loaded_keyframes() == 0 {
        return Err(DecodeError::Decode);
    }
    // libjxl refuses chroma subsampling with adaptive LF smoothing on;
    // jxl-oxide 0.12 doesn't check and hits an assert, which aborts the app.
    let invalid = (0..image.num_loaded_frames()).filter_map(|index| image.frame(index)).any(|frame| {
        let header = frame.header();
        header.jpeg_upsampling.iter().any(|&mode| mode != 0) && !header.flags.skip_adaptive_lf_smoothing()
    });
    if invalid {
        return Err(DecodeError::Decode);
    }
    tracker.expand_limit(width as usize * height as usize * BYTES_PER_PIXEL);
    let metadata = &image.image_header().metadata;
    let premultiplied = metadata
        .alpha()
        .and_then(|index| metadata.ec_info[index].alpha_associated())
        .unwrap_or(false);
    let srgb = if metadata.grayscale() {
        EnumColourEncoding::gray_srgb(RenderingIntent::Relative)
    } else {
        EnumColourEncoding::srgb(RenderingIntent::Relative)
    };
    image.request_color_encoding(srgb);
    let render = image.render_frame(0).map_err(|_| DecodeError::Decode)?;

    // Grey, grey and alpha, RGB, or RGBA, one row at a time.
    let mut stream = render.stream();
    let (width, height) = (stream.width(), stream.height());
    let channels = stream.channels() as usize;
    if too_large(width, height) || !(1..=4).contains(&channels) {
        return Err(DecodeError::Decode);
    }
    let mut row = vec![0f32; width as usize * channels];
    let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
    for _ in 0..height {
        stream.write_to_buffer(&mut row);
        for pixel in row.chunks_exact(channels) {
            let (colour, alpha) = match *pixel {
                [grey] => ([grey; 3], 1.0),
                [grey, alpha] => ([grey; 3], alpha),
                [red, green, blue] => ([red, green, blue], 1.0),
                [red, green, blue, alpha, ..] => ([red, green, blue], alpha),
                [] => unreachable!(),
            };
            let colour = if premultiplied && alpha > 0.0 {
                colour.map(|value| value / alpha)
            } else {
                colour
            };
            rgba.extend(colour.map(to_u8));
            rgba.push(to_u8(alpha));
        }
    }
    let rgba = RgbaImage::from_raw(width, height, rgba).ok_or(DecodeError::Decode)?;
    Ok(DynamicImage::ImageRgba8(rgba))
}

/// The codestream: the data itself, or for a container the contents of its
/// jxlc or jxlp boxes. The other boxes (Exif, XMP, JPEG reconstruction data)
/// aren't needed to decode, and jxl-oxide would unpack brotli-compressed ones
/// in full, however large.
fn codestream(data: &[u8]) -> Option<Cow<'_, [u8]>> {
    if !data.starts_with(CONTAINER) {
        return Some(Cow::Borrowed(data));
    }
    let mut codestream = Vec::new();
    let mut rest = data;
    while !rest.is_empty() {
        let size = u32::from_be_bytes(rest.get(0..4)?.try_into().ok()?);
        let kind = rest.get(4..8)?;
        let (start, size) = match size {
            0 => (8, rest.len()),
            1 => (16, usize::try_from(u64::from_be_bytes(rest.get(8..16)?.try_into().ok()?)).ok()?),
            size => (8, size as usize),
        };
        // A truncated last box keeps what is there.
        let end = size.min(rest.len());
        let content = rest.get(start..end)?;
        match kind {
            b"jxlc" => codestream.extend_from_slice(content),
            b"jxlp" => codestream.extend_from_slice(content.get(4..)?),
            _ => {}
        }
        rest = &rest[end..];
    }
    Some(Cow::Owned(codestream))
}

fn too_large(width: u32, height: u32) -> bool {
    width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS
}

fn to_u8(value: f32) -> u8 {
    (value * 255.0 + 0.5).clamp(0.0, 255.0) as u8
}
