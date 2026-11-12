//! What a file is, from its first bytes. The decoder (`image::decode`,
//! `image::Animation`) goes by `format` alone, whatever the file is called.
//! The folder scan uses `listed_kind` for files without a recognised
//! extension; it refuses formats whose signature is too weak to trust on its
//! own, so junk and camera RAW files are not listed.

use image::ImageFormat;
use std::fs::File;
use std::io::{ErrorKind, Read};

/// How much of a file `head` reads: enough for every signature here,
/// including an SVG's prolog and an Ogg file's first pages.
pub const HEAD_BYTES: usize = 4096;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Image = 1,
    Video = 2,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Format {
    /// Decoded by the `image` crate: JPEG, PNG, GIF, WebP, BMP, TIFF or ICO.
    Image(ImageFormat),
    Avif,
    Heic,
    Jxl,
    Svg,
    /// Any video container. libmpv tells them apart itself.
    Video,
}

impl Format {
    pub fn kind(self) -> Kind {
        match self {
            Format::Video => Kind::Video,
            _ => Kind::Image,
        }
    }
}

/// The `ftyp` brands of AVIF, which is HEIF with AV1 inside: `avif` for
/// stills, `avis` for sequences, `avio` for intra-only sequences.
const AVIF_BRANDS: &[&[u8; 4]] = &[b"avif", b"avis", b"avio"];

/// The `ftyp` brands of HEIF files whose images are HEVC: `heic` and `heix`
/// for stills (`heix` for 10-bit, 4:2:2 and the like), `heim` and `heis` for
/// multi-layer and scalable ones, `hevc` and the rest for sequences.
const HEVC_BRANDS: &[&[u8; 4]] = &[b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"hevm", b"hevs"];

/// Brands any HEIF file may carry, whatever its codec.
const HEIF_BRANDS: &[&[u8; 4]] = &[b"mif1", b"msf1", b"mif2"];

/// Major brands of ISO media files that hold no video: iTunes audio, audio
/// books and protected audio, Flash audio, Audible books, and Canon's CR3
/// camera RAW.
const NOT_VIDEO_BRANDS: &[&[u8; 4]] = &[b"M4A ", b"M4B ", b"M4P ", b"F4A ", b"F4B ", b"aax ", b"crx "];

/// The first `HEAD_BYTES` of the file, or all of it if it is shorter, in one
/// read. The scan calls this on every file without a recognised extension,
/// so it costs one seek and one read on a hard disk or network share.
pub fn head(file: &mut File) -> std::io::Result<Vec<u8>> {
    let mut head = vec![0; HEAD_BYTES];
    let length = loop {
        match file.read(&mut head) {
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            result => break result?,
        }
    };
    head.truncate(length);
    Ok(head)
}

/// The format the data starts like, for the decoder. Signatures are checked
/// as loosely as the decoders accept them; `listed_kind` is stricter.
pub fn format(data: &[u8]) -> Option<Format> {
    if data.get(4..8) == Some(b"ftyp") {
        return iso_media(data);
    }
    let image = |format| Some(Format::Image(format));
    match data {
        [0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n', ..] => image(ImageFormat::Png),
        [0xff, 0xd8, 0xff, ..] => image(ImageFormat::Jpeg),
        [b'G', b'I', b'F', b'8', b'7' | b'9', b'a', ..] => image(ImageFormat::Gif),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => image(ImageFormat::WebP),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'A', b'V', b'I', b' ', ..] => Some(Format::Video),
        [b'B', b'M', ..] => image(ImageFormat::Bmp),
        [b'I', b'I', b'*', 0, ..] | [b'M', b'M', 0, b'*', ..] => image(ImageFormat::Tiff),
        [0, 0, 1, 0, ..] => image(ImageFormat::Ico),
        _ if crate::jxl::is_jxl(data) => Some(Format::Jxl),
        [0x1a, 0x45, 0xdf, 0xa3, ..] if is_matroska(data) => Some(Format::Video),
        [b'O', b'g', b'g', b'S', ..] if is_ogg_video(data) => Some(Format::Video),
        _ if is_quicktime(data) => Some(Format::Video),
        _ if crate::svg::is_svg(data) => Some(Format::Svg),
        _ => None,
    }
}

/// The kind of a file the folder scan found without a recognised extension.
/// TIFF and ICO are never listed by content: camera RAW files (DNG, NEF,
/// ARW, CR2) start like TIFF and would fill a folder of RAW and JPEG pairs
/// with entries that fail to open, and ICO's signature is four bytes common
/// in binary files. BMP and JPEG, whose signatures are two and three bytes,
/// need a plausible header after them.
pub fn listed_kind(data: &[u8]) -> Option<Kind> {
    match format(data)? {
        Format::Image(ImageFormat::Tiff | ImageFormat::Ico) => None,
        Format::Image(ImageFormat::Bmp) if !is_plausible_bmp(data) => None,
        Format::Image(ImageFormat::Jpeg) if !is_plausible_jpeg(data) => None,
        format => Some(format.kind()),
    }
}

/// An ISO base media file (MP4, MOV, HEIF, AVIF), told apart by the brands
/// of its leading `ftyp` box; the box's size doesn't matter. HEIF that
/// doesn't say AVIF goes to libheif, which says what it can't decode.
fn iso_media(data: &[u8]) -> Option<Format> {
    let size = u32::from_be_bytes(data.get(0..4)?.try_into().ok()?) as usize;
    // Major brand, minor version, then four bytes per compatible brand.
    if size < 16 || !size.is_multiple_of(4) {
        return None;
    }
    let major: &[u8; 4] = data.get(8..12)?.try_into().ok()?;
    if !major.iter().all(|byte| (b' '..=b'~').contains(byte)) {
        return None;
    }
    let compatible = data.get(16..size.min(data.len()))?.chunks_exact(4);
    let brands: Vec<&[u8; 4]> = std::iter::once(major)
        .chain(compatible.filter_map(|brand| brand.try_into().ok()))
        .collect();
    let has = |list: &[&[u8; 4]]| brands.iter().any(|brand| list.contains(brand));
    if has(AVIF_BRANDS) {
        Some(Format::Avif)
    } else if has(HEVC_BRANDS) || has(HEIF_BRANDS) {
        Some(Format::Heic)
    } else if NOT_VIDEO_BRANDS.contains(&major) {
        None
    } else {
        Some(Format::Video)
    }
}

/// An EBML header whose document type is Matroska or WebM.
fn is_matroska(data: &[u8]) -> bool {
    let header = &data[..data.len().min(64)];
    [&b"matroska"[..], b"webm"]
        .iter()
        .any(|doc_type| header.windows(doc_type.len()).any(|window| window == *doc_type))
}

/// An Ogg file whose opening pages start a Theora stream. Each stream's
/// first page comes before any other page, so they are all at the start;
/// an Ogg Skeleton stream, if there is one, comes first. Vorbis and Opus
/// audio are not video.
fn is_ogg_video(data: &[u8]) -> bool {
    let mut page = data;
    // A page header is 27 bytes, then a table of segment lengths. Flag 2
    // marks a stream's first page.
    while let [b'O', b'g', b'g', b'S', 0, flags, ..] = page {
        if flags & 0x02 == 0 {
            return false;
        }
        let Some(&segments) = page.get(26) else {
            return false;
        };
        let Some(lengths) = page.get(27..27 + segments as usize) else {
            return false;
        };
        let body = &page[27 + segments as usize..];
        if body.starts_with(b"\x80theora") {
            return true;
        }
        let length = lengths.iter().map(|&length| length as usize).sum::<usize>();
        page = body.get(length..).unwrap_or_default();
    }
    false
}

/// An old QuickTime file without an `ftyp` box: a movie or media atom,
/// possibly after padding atoms.
fn is_quicktime(data: &[u8]) -> bool {
    let mut offset = 0;
    while let Some(atom) = data.get(offset..offset + 8) {
        let size = u32::from_be_bytes([atom[0], atom[1], atom[2], atom[3]]) as usize;
        match &atom[4..8] {
            b"moov" | b"mdat" => return size >= 8,
            b"free" | b"skip" | b"wide" | b"pnot" if size >= 8 => offset += size,
            _ => return false,
        }
    }
    false
}

/// A BMP file header followed by one of the info headers the decoder reads,
/// with the pixels after it.
fn is_plausible_bmp(data: &[u8]) -> bool {
    let Some(header) = data.get(10..18) else {
        return false;
    };
    let pixels = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let info = u32::from_le_bytes([header[4], header[5], header[6], header[7]]);
    [12, 40, 52, 56, 108, 124].contains(&info) && pixels >= 14 + info
}

/// A JPEG start marker followed by a frame, table or application marker
/// segment with a valid length.
fn is_plausible_jpeg(data: &[u8]) -> bool {
    match data {
        [0xff, 0xd8, 0xff, marker, high, low, ..] => {
            matches!(marker, 0xc0..=0xcf | 0xdb..=0xfe) && u16::from_be_bytes([*high, *low]) >= 2
        }
        _ => false,
    }
}
