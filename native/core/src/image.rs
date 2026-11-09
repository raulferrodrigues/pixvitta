//! Still-image decoding to sRGB RGBA8, straight alpha, EXIF orientation
//! applied. The `image` crate decodes; moxcms (which `image` already uses)
//! converts embedded ICC profiles to sRGB. Only the first frame of an
//! animated file is decoded for now.

use image::{DynamicImage, ImageDecoder, ImageReader};
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
    let mut decoder = ImageReader::open(path)
        .map_err(|_| DecodeError::Io)?
        .with_guessed_format()
        .map_err(|_| DecodeError::Io)?
        .into_decoder()?;
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
