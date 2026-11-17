//! HEIC and AVIF stills, through libheif (built from `vendor/` by build.rs),
//! called through `heif_shim.cc`. HEVC decodes with libde265, AV1 with rav1d
//! (`av1.rs`), which the shim registers with libheif as a decoder plugin.
//! libheif decodes the primary image, grids and alpha included, applies its
//! rotation, mirroring and cropping (`irot`, `imir`, `clap`; an EXIF
//! orientation is ignored, as the HEIF spec says), and converts it to 8-bit
//! RGBA with the matrix and range of the file's nclx, or of the bitstream when
//! the file has none. The ICC profile is returned for the caller to convert.
//! Image sequences (animated AVIF, HEIF sequences) show their primary still
//! image if they have one; other auxiliary images and other codecs are not
//! decoded.

use crate::image::DecodeError;
use image::{DynamicImage, RgbaImage};
use std::borrow::Cow;
use std::ffi::c_int;
use std::ops::Range;

/// Larger pictures are refused: 512 MiB of RGBA, the `image` crate's
/// default allocation limit.
pub const MAX_PIXELS: u64 = 1 << 27;

/// Grid tiles decoded at once. Each has its own decoder for the length of the
/// decode: libde265 with one worker thread, or rav1d with its share of the
/// machine's threads (at least two).
const MAX_THREADS: usize = 8;

/// The primary image, upright, as RGBA8 with straight alpha, and its ICC
/// profile if it has one.
pub fn decode(data: &[u8]) -> Result<(DynamicImage, Option<Vec<u8>>), DecodeError> {
    let data = with_explicit_unspecified_colour(data);
    let threads = std::thread::available_parallelism().map_or(1, |count| count.get());
    let mut picture = Picture::default();
    // SAFETY: libheif reads `data` in place for as long as its context
    // lives, which `picture` holds until it is dropped at the end of this
    // function; `picture` is released once, by its Drop.
    let result = unsafe {
        pv_heif_decode(
            data.as_ptr(),
            data.len(),
            MAX_PIXELS,
            threads.min(256) as c_int,
            threads.min(MAX_THREADS) as c_int,
            &mut picture,
        )
    };
    match result {
        0 => {}
        1 => return Err(DecodeError::Unsupported),
        _ => return Err(DecodeError::Decode),
    }
    let rgba = picture.rgba()?;
    let icc = picture.icc().map(<[u8]>::to_vec);
    Ok((DynamicImage::ImageRgba8(rgba), icc))
}

/// libheif 1.23 marks a missing colour box with an nclx of unspecified
/// primaries, transfer and matrix and full range, so it takes a box that says
/// exactly that for no box at all and goes by the bitstream's colour
/// description instead, which may say limited range. The box should win (as
/// the spec, libavif and browsers have it), and Windows' AVIF encoder writes
/// such boxes over limited-range AV1. So each one is rewritten, in a copy of
/// the file, at the same size, to the values libheif puts in for unspecified
/// ones when it converts the colour (BT.709 primaries, sRGB transfer, BT.601
/// matrix), keeping its range: the picture means the same, and libheif
/// honours it. This can go once libheif honours such a box itself.
fn with_explicit_unspecified_colour(data: &[u8]) -> Cow<'_, [u8]> {
    let mut found = Vec::new();
    for (_, meta) in boxes(data, 0..data.len()).filter(|(kind, _)| kind == b"meta") {
        // `meta` is a full box: version and flags come before its boxes.
        let meta = meta.start.saturating_add(4).min(meta.end)..meta.end;
        for (_, iprp) in boxes(data, meta).filter(|(kind, _)| kind == b"iprp") {
            for (_, ipco) in boxes(data, iprp).filter(|(kind, _)| kind == b"ipco") {
                for (_, colr) in boxes(data, ipco).filter(|(kind, _)| kind == b"colr") {
                    // Colour type, then primaries, transfer and matrix (16
                    // bits each), then the full range flag in the top bit.
                    let body = &data[colr.clone()];
                    let unspecified = body.get(0..10) == Some(&b"nclx\0\x02\0\x02\0\x02"[..]);
                    if unspecified && body.get(10).is_some_and(|flags| flags & 0x80 != 0) {
                        found.push(colr.start + 4);
                    }
                }
            }
        }
    }
    if found.is_empty() {
        return Cow::Borrowed(data);
    }
    let mut copy = data.to_vec();
    for at in found {
        copy[at..at + 6].copy_from_slice(&[0, 1, 0, 13, 0, 6]);
    }
    Cow::Owned(copy)
}

/// The boxes within `range` of `data`, as their type and the range of their
/// contents. Stops at the first box that doesn't fit.
fn boxes(data: &[u8], range: Range<usize>) -> impl Iterator<Item = ([u8; 4], Range<usize>)> + '_ {
    let mut at = range.start;
    let end = range.end.min(data.len());
    std::iter::from_fn(move || {
        let header = data.get(at..at.checked_add(8)?.min(end))?;
        let kind: [u8; 4] = header.get(4..8)?.try_into().ok()?;
        let (start, size) = match u32::from_be_bytes(header[0..4].try_into().ok()?) {
            // To the end of the enclosing box.
            0 => (at + 8, end - at),
            // A 64-bit size follows the type.
            1 => {
                let size = data.get(at + 8..at.checked_add(16)?.min(end))?;
                (at + 16, usize::try_from(u64::from_be_bytes(size.try_into().ok()?)).ok()?)
            }
            size => (at + 8, size as usize),
        };
        let stop = at.checked_add(size)?;
        if stop < start || stop > end {
            return None;
        }
        at = stop;
        Some((kind, start..stop))
    })
}

/// `pv_heif_picture` in heif_shim.cc.
#[repr(C)]
struct Picture {
    context: *mut std::ffi::c_void,
    image: *const std::ffi::c_void,
    rgba: *const u8,
    stride: usize,
    width: u32,
    height: u32,
    premultiplied: u8,
    icc: *mut u8,
    icc_size: usize,
}

impl Default for Picture {
    fn default() -> Picture {
        Picture {
            context: std::ptr::null_mut(),
            image: std::ptr::null(),
            rgba: std::ptr::null(),
            stride: 0,
            width: 0,
            height: 0,
            premultiplied: 0,
            icc: std::ptr::null_mut(),
            icc_size: 0,
        }
    }
}

impl Picture {
    /// A copy of the pixels with straight alpha. libheif leaves a file's
    /// premultiplied alpha (`prem`) as it is.
    fn rgba(&self) -> Result<RgbaImage, DecodeError> {
        let (width, height) = (self.width as usize, self.height as usize);
        let row = width * 4;
        if self.rgba.is_null() || self.stride < row {
            return Err(DecodeError::Decode);
        }
        let mut rgba = Vec::new();
        rgba.try_reserve_exact(row * height).map_err(|_| DecodeError::Decode)?;
        for y in 0..height {
            // SAFETY: libheif's plane has `height` rows `stride` bytes apart,
            // and the shim checked that a row holds `width` pixels.
            rgba.extend_from_slice(unsafe { std::slice::from_raw_parts(self.rgba.add(y * self.stride), row) });
        }
        if self.premultiplied != 0 {
            for pixel in rgba.chunks_exact_mut(4) {
                let alpha = u32::from(pixel[3]);
                for value in &mut pixel[..3] {
                    if let Some(straight) = (u32::from(*value) * 255 + alpha / 2).checked_div(alpha) {
                        *value = straight.min(255) as u8;
                    }
                }
            }
        }
        RgbaImage::from_raw(self.width, self.height, rgba).ok_or(DecodeError::Decode)
    }

    fn icc(&self) -> Option<&[u8]> {
        // SAFETY: the shim allocated `icc_size` bytes at `icc`.
        (!self.icc.is_null()).then(|| unsafe { std::slice::from_raw_parts(self.icc, self.icc_size) })
    }
}

impl Drop for Picture {
    fn drop(&mut self) {
        // SAFETY: the picture came from pv_heif_decode (or is empty, which
        // release accepts) and is released once, here.
        unsafe { pv_heif_release(self) }
    }
}

extern "C" {
    fn pv_heif_decode(
        data: *const u8,
        size: usize,
        max_pixels: u64,
        threads: c_int,
        tile_threads: c_int,
        out: *mut Picture,
    ) -> c_int;
    fn pv_heif_release(picture: *mut Picture);
}
