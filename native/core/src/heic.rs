//! Still HEIC images, through libheif with libde265 (built from `vendor/` by
//! build.rs), called through `heic_shim.cc`. libheif decodes the primary
//! image, grids included, applies its rotation, mirroring and cropping
//! (`irot`, `imir`, `clap`; an EXIF orientation is ignored, as the HEIF spec
//! says), and converts it to 8-bit RGBA with the matrix and range of the
//! file's nclx. The ICC profile is returned for the caller to convert, as for
//! AVIF. Image sequences, auxiliary images and codecs other than HEVC are not
//! decoded.

use crate::image::DecodeError;
use image::{DynamicImage, RgbaImage};
use std::ffi::c_int;

/// Larger pictures are refused: 512 MiB of RGBA, as for AVIF.
const MAX_PIXELS: u64 = 1 << 27;

/// Grid tiles decoded at once. Each has its own libde265 decoder and worker
/// thread for the length of the decode.
const MAX_THREADS: usize = 8;

/// The `ftyp` brands of HEIF files whose images are HEVC: `heic` and `heix`
/// for stills (`heix` for 10-bit, 4:2:2 and the like), `heim` and `heis` for
/// multi-layer and scalable ones, `hevc` and the rest for sequences.
const HEVC_BRANDS: &[&[u8; 4]] = &[b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"hevm", b"hevs"];

/// Brands any HEIF file may carry, whatever its codec.
const HEIF_BRANDS: &[&[u8; 4]] = &[b"mif1", b"msf1", b"mif2"];

/// Brands of AVIF, which is HEIF with AV1 inside and goes to `avif`.
const AVIF_BRANDS: &[&[u8; 4]] = &[b"avif", b"avis", b"avio"];

/// Whether the data starts with an `ftyp` box whose brands (major or
/// compatible) say HEIF with HEVC, or HEIF without saying AVIF.
pub fn is_heic(data: &[u8]) -> bool {
    let Some(brands) = brands(data) else {
        return false;
    };
    let has = |list: &[&[u8; 4]]| brands.iter().any(|brand| list.contains(brand));
    has(HEVC_BRANDS) || (has(HEIF_BRANDS) && !has(AVIF_BRANDS))
}

/// The major brand and the compatible brands of a leading `ftyp` box.
fn brands(data: &[u8]) -> Option<Vec<&[u8; 4]>> {
    if data.get(4..8)? != b"ftyp" {
        return None;
    }
    let size = u32::from_be_bytes(data.get(0..4)?.try_into().ok()?) as usize;
    if size < 16 {
        return None;
    }
    let ftyp = data.get(8..size)?;
    // The minor version sits between the major brand and the rest.
    let major = ftyp[0..4].try_into().ok()?;
    let compatible = ftyp[8..].chunks_exact(4).filter_map(|brand| brand.try_into().ok());
    Some(std::iter::once(major).chain(compatible).collect())
}

/// The primary image, upright, as RGBA8 with straight alpha, and its ICC
/// profile if it has one.
pub fn decode(data: &[u8]) -> Result<(DynamicImage, Option<Vec<u8>>), DecodeError> {
    let threads = std::thread::available_parallelism().map_or(1, |count| count.get());
    let mut picture = Picture::default();
    // SAFETY: libheif reads `data` in place for as long as its context
    // lives, which `picture` holds until it is dropped at the end of this
    // function; `picture` is released once, by its Drop.
    let result = unsafe {
        pv_heic_decode(
            data.as_ptr(),
            data.len(),
            MAX_PIXELS,
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

/// `pv_heic_picture` in heic_shim.cc.
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
        // SAFETY: the picture came from pv_heic_decode (or is empty, which
        // release accepts) and is released once, here.
        unsafe { pv_heic_release(self) }
    }
}

extern "C" {
    fn pv_heic_decode(data: *const u8, size: usize, max_pixels: u64, threads: c_int, out: *mut Picture) -> c_int;
    fn pv_heic_release(picture: *mut Picture);
}
