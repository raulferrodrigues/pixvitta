//! AV1 decoding with rav1d, as libheif's AV1 decoder. `heif_shim.cc`
//! registers a libheif decoder plugin whose decode step calls
//! `pv_av1_decode` with an image's AV1 data and copies the planes it returns
//! into libheif's image; libheif does everything else (the container, grids,
//! alpha, colour conversion, rotation and mirroring), as for HEIC.

use crate::heif::MAX_PIXELS;
use rav1d::include::dav1d::data::Dav1dData;
use rav1d::include::dav1d::dav1d::{Dav1dContext, Dav1dSettings};
use rav1d::include::dav1d::headers::{DAV1D_PIXEL_LAYOUT_I400, DAV1D_PIXEL_LAYOUT_I420, DAV1D_PIXEL_LAYOUT_I422};
use rav1d::include::dav1d::picture::Dav1dPicture;
use rav1d::src::lib::{
    dav1d_close, dav1d_data_create, dav1d_data_unref, dav1d_default_settings, dav1d_get_picture, dav1d_open,
    dav1d_picture_unref, dav1d_send_data,
};
use rav1d::Dav1dResult;
use std::ffi::c_int;
use std::mem::MaybeUninit;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr::{self, NonNull};

/// `pv_av1_frame` in heif_shim.cc: a decoded picture's planes, valid until
/// `pv_av1_release`. Planes 1 and 2 are null for a monochrome picture.
#[repr(C)]
pub struct Frame {
    picture: *mut Av1Picture,
    planes: [*const u8; 3],
    strides: [usize; 3],
    widths: [u32; 3],
    heights: [u32; 3],
    bits: u32,
    // rav1d's pixel layout: 0 monochrome, 1 4:2:0, 2 4:2:2, 3 4:4:4.
    layout: u32,
    // The colour description in the sequence header, as nclx code points.
    primaries: u16,
    transfer: u16,
    matrix: u16,
    full_range: u8,
}

/// Decodes the AV1 data at `data` (the configuration OBUs and the image's
/// OBUs, as libheif hands them to a decoder) on `threads` threads, at least
/// two. Returns 0 and fills `out` on success, to be given back with
/// `pv_av1_release`; nonzero if the data doesn't decode. A panic while
/// decoding becomes a failure, so it never unwinds into libheif.
#[no_mangle]
pub unsafe extern "C" fn pv_av1_decode(data: *const u8, size: usize, threads: c_int, out: *mut Frame) -> c_int {
    if data.is_null() || out.is_null() {
        return 1;
    }
    let data = std::slice::from_raw_parts(data, size);
    let frame = catch_unwind(AssertUnwindSafe(|| {
        let picture = Box::new(Av1Picture::decode(data, threads)?);
        picture.frame()
    }));
    match frame {
        Ok(Some(frame)) => {
            out.write(frame);
            0
        }
        _ => 1,
    }
}

/// Releases a frame from `pv_av1_decode`. The decoder's threads have all
/// ended by the time this returns.
#[no_mangle]
pub unsafe extern "C" fn pv_av1_release(frame: *mut Frame) {
    if let Some(frame) = frame.as_mut() {
        let picture = std::mem::replace(&mut frame.picture, ptr::null_mut());
        if !picture.is_null() {
            // A panic here would leak the picture rather than unwind into C++.
            let _ = catch_unwind(AssertUnwindSafe(|| drop(Box::from_raw(picture))));
        }
    }
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
            if std::thread::current()
                .name()
                .is_some_and(|name| name.starts_with("rav1d-worker"))
            {
                std::process::abort();
            }
        }));
    });
}

impl Av1Picture {
    fn decode(data: &[u8], threads: c_int) -> Option<Av1Picture> {
        if data.is_empty() {
            return None;
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
            settings.n_threads = threads.clamp(2, 256);
            settings.max_frame_delay = 2;
            settings.all_layers = 0;
            settings.frame_size_limit = MAX_PIXELS as u32;
            // A logger with no callback (all zero) keeps rav1d off stderr.
            settings.logger = std::mem::zeroed();
            check(dav1d_open(
                Some(NonNull::from(&mut decoded.context)),
                Some(NonNull::from(&mut settings)),
            ))?;
            let context = decoded.context?;

            let mut input = Dav1dData::default();
            let buffer = dav1d_data_create(Some(NonNull::from(&mut input)), data.len());
            if buffer.is_null() {
                return None;
            }
            ptr::copy_nonoverlapping(data.as_ptr(), buffer, data.len());
            // rav1d takes all the data at once. The first ask for the picture
            // can come back empty while frame threads work; the next waits
            // for them.
            let sent = dav1d_send_data(Some(context), Some(NonNull::from(&mut input)));
            let mut result = None;
            if sent.0 >= 0 {
                for _ in 0..3 {
                    let got = dav1d_get_picture(Some(context), Some(NonNull::from(&mut decoded.picture)));
                    if got.0 == 0 {
                        result = Some(());
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
        Some(decoded)
    }

    /// The planes for libheif, checked against what rav1d allocated. Takes
    /// ownership of the picture, which `pv_av1_release` frees.
    fn frame(self: Box<Av1Picture>) -> Option<Frame> {
        let p = &self.picture.p;
        let (width, height) = (u32::try_from(p.w).ok()?, u32::try_from(p.h).ok()?);
        if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
            return None;
        }
        let bits = match p.bpc {
            bits @ (8 | 10 | 12) => bits as u32,
            _ => return None,
        };
        // SAFETY: the header belongs to the picture and lives as long as it.
        let header = unsafe { self.picture.seq_hdr?.as_ref() };
        let horizontal = (p.layout == DAV1D_PIXEL_LAYOUT_I420 || p.layout == DAV1D_PIXEL_LAYOUT_I422) as u32;
        let vertical = (p.layout == DAV1D_PIXEL_LAYOUT_I420) as u32;
        let planes = if p.layout == DAV1D_PIXEL_LAYOUT_I400 { 1 } else { 3 };
        let mut frame = Frame {
            picture: ptr::null_mut(),
            planes: [ptr::null(); 3],
            strides: [0; 3],
            widths: [0; 3],
            heights: [0; 3],
            bits,
            layout: p.layout,
            primaries: u16::try_from(header.pri).ok()?,
            transfer: u16::try_from(header.trc).ok()?,
            matrix: u16::try_from(header.mtrx).ok()?,
            full_range: (header.color_range != 0) as u8,
        };
        for index in 0..planes {
            let (plane_width, plane_height) = match index {
                0 => (width, height),
                _ => ((width + horizontal) >> horizontal, (height + vertical) >> vertical),
            };
            let stride = usize::try_from(self.picture.stride[index.min(1)]).ok()?;
            let row = plane_width as usize * if bits > 8 { 2 } else { 1 };
            if stride < row {
                return None;
            }
            frame.planes[index] = self.picture.data[index]?.as_ptr() as *const u8;
            frame.strides[index] = stride;
            frame.widths[index] = plane_width;
            frame.heights[index] = plane_height;
        }
        frame.picture = Box::into_raw(self);
        Some(frame)
    }
}

impl Drop for Av1Picture {
    fn drop(&mut self) {
        // SAFETY: both come from rav1d and are released once, here. Closing
        // the context joins its worker threads.
        unsafe {
            dav1d_picture_unref(Some(NonNull::from(&mut self.picture)));
            dav1d_close(Some(NonNull::from(&mut self.context)));
        }
    }
}

fn check(result: Dav1dResult) -> Option<()> {
    (result.0 >= 0).then_some(())
}

/// rav1d's EAGAIN: it wants the other call (send or get) first.
fn again(result: Dav1dResult) -> bool {
    std::io::Error::from_raw_os_error(-result.0).kind() == std::io::ErrorKind::WouldBlock
}
