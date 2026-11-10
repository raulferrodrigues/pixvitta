//! Still-image decoding to sRGB RGBA8, straight alpha, EXIF orientation
//! applied. The `image` crate decodes; moxcms (which `image` already uses)
//! converts embedded ICC profiles to sRGB. Only the first frame of an
//! animated file is decoded for now.

use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};
use std::io::{BufRead, Cursor, Seek};
use std::path::Path;

pub struct Decoded {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

pub enum DecodeError {
    Io,
    Unsupported,
    Decode,
}

impl From<image::ImageError> for DecodeError {
    fn from(error: image::ImageError) -> DecodeError {
        match error {
            image::ImageError::IoError(_) => DecodeError::Io,
            image::ImageError::Unsupported(_) => DecodeError::Unsupported,
            _ => DecodeError::Decode,
        }
    }
}

pub fn decode(path: &Path) -> Result<Decoded, DecodeError> {
    // Only pixel dimensions are used. Density metadata (PNG pHYs, JFIF or
    // EXIF DPI) is ignored, so a 144-DPI screenshot and a 72-DPI one with the
    // same pixels display at the same size.
    let reader = ImageReader::open(path)
        .map_err(|_| DecodeError::Io)?
        .with_guessed_format()
        .map_err(|_| DecodeError::Io)?;
    let is_ico = reader.format() == Some(ImageFormat::Ico);
    match decode_reader(reader) {
        Err(DecodeError::Decode) if is_ico => {
            let png = ico_png_entry(path).ok_or(DecodeError::Decode)?;
            decode_reader(ImageReader::with_format(Cursor::new(png), ImageFormat::Png))
        }
        result => result,
    }
}

fn decode_reader<R: BufRead + Seek>(reader: ImageReader<R>) -> Result<Decoded, DecodeError> {
    let mut decoder = reader.into_decoder()?;
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let icc = decoder.icc_profile().ok().flatten();
    let mut picture = DynamicImage::from_decoder(decoder)?;
    picture.apply_orientation(orientation);
    let rgba = picture.into_rgba8();
    let (width, height) = rgba.dimensions();
    let mut rgba = rgba.into_raw();
    if let Some(icc) = icc {
        to_srgb(&icc, &mut rgba);
    }
    Ok(Decoded { width, height, rgba })
}

/// The `image` crate refuses an ICO whose chosen entry is a PNG that isn't
/// 8-bit RGBA, but ImageMagick writes palette PNGs and Windows opens them.
/// Returns the largest entry's bytes when that entry is a PNG, so it can be
/// decoded on its own.
fn ico_png_entry(path: &Path) -> Option<Vec<u8>> {
    let data = std::fs::read(path).ok()?;
    let count = u16::from_le_bytes(data.get(4..6)?.try_into().ok()?) as usize;
    let side = |byte: u8| if byte == 0 { 256 } else { u32::from(byte) };
    let mut largest: Option<(u32, &[u8])> = None;
    for index in 0..count {
        let entry = data.get(6 + 16 * index..22 + 16 * index)?;
        let area = side(entry[0]) * side(entry[1]);
        let size = u32::from_le_bytes(entry[8..12].try_into().ok()?) as usize;
        let offset = u32::from_le_bytes(entry[12..16].try_into().ok()?) as usize;
        let bytes = data.get(offset..offset.checked_add(size)?)?;
        if largest.is_none_or(|(best, _)| area > best) {
            largest = Some((area, bytes));
        }
    }
    let (_, bytes) = largest?;
    bytes.starts_with(b"\x89PNG\r\n\x1a\n").then(|| bytes.to_vec())
}

/// Converts RGBA8 pixels from an embedded RGB profile to sRGB. Profiles
/// moxcms can't read, and grey or CMYK profiles (whose pixels the `image`
/// crate has already expanded to RGB), leave the pixels as they are.
fn to_srgb(icc: &[u8], rgba: &mut Vec<u8>) {
    let Ok(input) = moxcms::ColorProfile::new_from_slice(icc) else {
        return;
    };
    if input.color_space != moxcms::DataColorSpace::Rgb {
        return;
    }
    let output = moxcms::ColorProfile::new_srgb();
    let options = moxcms::TransformOptions::default();
    let Ok(transform) = input.create_transform_8bit(moxcms::Layout::Rgba, &output, moxcms::Layout::Rgba, options)
    else {
        return;
    };
    let mut converted = vec![0; rgba.len()];
    if transform.transform(rgba, &mut converted).is_ok() {
        *rgba = converted;
    }
}
