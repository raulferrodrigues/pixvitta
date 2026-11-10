//! Image decoding to sRGB RGBA8, straight alpha, EXIF orientation applied.
//! The `image` crate decodes; moxcms (which `image` already uses) converts
//! embedded ICC profiles to sRGB; AVIF goes through `avif`. `decode` reads a
//! still (the first frame of an animated file); `Animation` plays GIF and WebP
//! frame by frame.

use image::codecs::gif::GifDecoder;
use image::codecs::webp::WebPDecoder;
use image::metadata::Orientation;
use image::{AnimationDecoder, DynamicImage, Frame, Frames, ImageDecoder, ImageFormat, ImageReader};
use std::fs::File;
use std::io::{BufRead, BufReader, Cursor, Seek};
use std::path::{Path, PathBuf};
use std::sync::Arc;

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
    if reader.format() == Some(ImageFormat::Avif) {
        let data = std::fs::read(path).map_err(|_| DecodeError::Io)?;
        let (picture, icc) = crate::avif::decode(&data)?;
        let srgb = icc.and_then(|icc| srgb_transform(&icc));
        return Ok(finish(picture, Orientation::NoTransforms, srgb.as_deref()));
    }
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
    let srgb = decoder
        .icc_profile()
        .ok()
        .flatten()
        .and_then(|icc| srgb_transform(&icc));
    let picture = DynamicImage::from_decoder(decoder)?;
    Ok(finish(picture, orientation, srgb.as_deref()))
}

fn finish(mut picture: DynamicImage, orientation: Orientation, srgb: Option<&Transform>) -> Decoded {
    picture.apply_orientation(orientation);
    let rgba = picture.into_rgba8();
    let (width, height) = rgba.dimensions();
    let mut rgba = rgba.into_raw();
    if let Some(transform) = srgb {
        to_srgb(transform, &mut rgba);
    }
    Decoded { width, height, rgba }
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

type Transform = moxcms::Transform8BitExecutor;

/// The conversion of RGBA8 pixels from an embedded RGB profile to sRGB.
/// None for profiles moxcms can't read, and for grey or CMYK profiles (whose
/// pixels the `image` crate has already expanded to RGB): those pixels are
/// left as they are.
fn srgb_transform(icc: &[u8]) -> Option<Arc<Transform>> {
    let input = moxcms::ColorProfile::new_from_slice(icc).ok()?;
    if input.color_space != moxcms::DataColorSpace::Rgb {
        return None;
    }
    let output = moxcms::ColorProfile::new_srgb();
    let options = moxcms::TransformOptions::default();
    input
        .create_transform_8bit(moxcms::Layout::Rgba, &output, moxcms::Layout::Rgba, options)
        .ok()
}

fn to_srgb(transform: &Transform, rgba: &mut Vec<u8>) {
    let mut converted = vec![0; rgba.len()];
    if transform.transform(rgba, &mut converted).is_ok() {
        *rgba = converted;
    }
}

/// A file played frame by frame, one frame decoded per call, looping
/// forever. GIF and WebP animations are read as such; every other file, and
/// an animation with a single frame, is a still.
pub struct Animation {
    path: PathBuf,
    // None for a still: each call decodes the file again with `decode`.
    playback: Option<Playback>,
    // Set once a second frame has been seen.
    animated: bool,
}

struct Playback {
    format: ImageFormat,
    // The frames iterators hold plain readers and buffers, so moving them to
    // another thread is fine even though `Frames` doesn't say so.
    frames: Frames<'static>,
    // How many frames this pass has handed out.
    position: usize,
    // A frame read early, to tell an animation from a single frame.
    ahead: Option<Frame>,
    orientation: Orientation,
    srgb: Option<Arc<Transform>>,
}

impl Animation {
    pub fn open(path: &Path) -> Result<Animation, DecodeError> {
        let reader = ImageReader::open(path)
            .map_err(|_| DecodeError::Io)?
            .with_guessed_format()
            .map_err(|_| DecodeError::Io)?;
        let playback = match reader.format() {
            Some(format @ (ImageFormat::Gif | ImageFormat::WebP)) => Playback::open(reader.into_inner(), format)?,
            _ => None,
        };
        Ok(Animation {
            path: path.to_path_buf(),
            playback,
            animated: false,
        })
    }

    /// The next frame and how long to show it in milliseconds; 0 for a still.
    pub fn next_frame(&mut self) -> Result<(Decoded, u32), DecodeError> {
        let Some(playback) = &mut self.playback else {
            return Ok((decode(&self.path)?, 0));
        };
        let frame = match playback.ahead.take() {
            Some(frame) => frame,
            None => playback.next(&self.path)?,
        };
        let mut duration = frame_duration(&frame);
        if !self.animated {
            match playback.frames.next() {
                Some(Ok(second)) => {
                    playback.ahead = Some(second);
                    playback.position += 1;
                    self.animated = true;
                }
                _ => duration = 0,
            }
        }
        let decoded = finish(
            DynamicImage::ImageRgba8(frame.into_buffer()),
            playback.orientation,
            playback.srgb.as_deref(),
        );
        if duration == 0 {
            self.playback = None;
        }
        Ok((decoded, duration))
    }
}

impl Playback {
    /// None for a WebP still.
    fn open(file: BufReader<File>, format: ImageFormat) -> Result<Option<Playback>, DecodeError> {
        fn start<D: ImageDecoder + AnimationDecoder<'static>>(mut decoder: D, format: ImageFormat) -> Playback {
            let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
            let srgb = decoder
                .icc_profile()
                .ok()
                .flatten()
                .and_then(|icc| srgb_transform(&icc));
            Playback {
                format,
                frames: decoder.into_frames(),
                position: 0,
                ahead: None,
                orientation,
                srgb,
            }
        }
        if format == ImageFormat::Gif {
            return Ok(Some(start(GifDecoder::new(file)?, format)));
        }
        let decoder = WebPDecoder::new(file)?;
        Ok(decoder.has_animation().then(|| start(decoder, format)))
    }

    fn next(&mut self, path: &Path) -> Result<Frame, DecodeError> {
        // A frame that fails to decode ends the pass, as the end of the file
        // does, so a damaged animation still plays the frames before it.
        match self.frames.next() {
            Some(Ok(frame)) => {
                self.position += 1;
                return Ok(frame);
            }
            Some(Err(error)) if self.position == 0 => return Err(error.into()),
            None if self.position == 0 => return Err(DecodeError::Decode),
            _ => {}
        }
        let file = BufReader::new(File::open(path).map_err(|_| DecodeError::Io)?);
        *self = Playback::open(file, self.format)?.ok_or(DecodeError::Decode)?;
        self.next(path)
    }
}

/// Durations of 10 ms or less are shown for 100 ms, as browsers do.
fn frame_duration(frame: &Frame) -> u32 {
    let (numer, denom) = frame.delay().numer_denom_ms();
    let milliseconds = numer / denom.max(1);
    if milliseconds <= 10 {
        100
    } else {
        milliseconds
    }
}
