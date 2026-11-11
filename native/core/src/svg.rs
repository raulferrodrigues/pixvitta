//! Still SVG and SVGZ images, through resvg, rendered once at the size the
//! file declares. Like a browser showing an SVG in an `<img>` tag, nothing
//! outside the file is loaded: `data:` images work, other links are ignored.
//! Scripts and animations are ignored too, so the static state is shown.

use crate::image::DecodeError;
use flate2::read::GzDecoder;
use image::{DynamicImage, RgbaImage};
use resvg::usvg::{fontdb, roxmltree, ImageHrefResolver, Options, Tree};
use std::io::Read;
use std::sync::{Arc, OnceLock};

/// Larger pictures are refused: 512 MiB of RGBA, as for AVIF.
const MAX_PIXELS: u64 = 1 << 27;

/// How much of the file is looked at to tell whether it is an SVG.
const SNIFF_BYTES: usize = 4096;

/// Larger documents, after decompressing an SVGZ, are refused.
const MAX_DOCUMENT_BYTES: u64 = 256 << 20;

/// Deeper element nesting is refused. usvg and resvg walk the tree
/// recursively, so a deep enough file would overflow the stack.
const MAX_DEPTH: usize = 1024;

/// Whether the root element of the document (gzip-compressed or not) is
/// `<svg`, looking only at its start.
pub fn is_svg(data: &[u8]) -> bool {
    if data.starts_with(&[0x1f, 0x8b]) {
        let mut start = Vec::new();
        let _ = GzDecoder::new(data).take(SNIFF_BYTES as u64).read_to_end(&mut start);
        return !start.starts_with(&[0x1f, 0x8b]) && is_svg(&start);
    }
    let mut rest = &data[..data.len().min(SNIFF_BYTES)];
    rest = rest.strip_prefix(b"\xef\xbb\xbf").unwrap_or(rest);
    loop {
        rest = rest.trim_ascii_start();
        let end = if rest.starts_with(b"<?") {
            find(rest, b"?>")
        } else if rest.starts_with(b"<!--") {
            find(rest, b"-->")
        } else if rest.starts_with(b"<!DOCTYPE") {
            doctype_end(rest)
        } else {
            let tag = rest.strip_prefix(b"<svg").and_then(|tag| tag.first());
            return tag.is_some_and(|&next| next.is_ascii_whitespace() || next == b'>' || next == b'/');
        };
        match end {
            Some(end) => rest = &rest[end..],
            None => return false,
        }
    }
}

/// The picture as RGBA8 with straight alpha, on a transparent background.
pub fn decode(data: &[u8]) -> Result<DynamicImage, DecodeError> {
    let mut document = Vec::new();
    let data = if data.starts_with(&[0x1f, 0x8b]) {
        GzDecoder::new(data)
            .take(MAX_DOCUMENT_BYTES + 1)
            .read_to_end(&mut document)
            .map_err(|_| DecodeError::Decode)?;
        &document[..]
    } else {
        data
    };
    if data.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(DecodeError::Decode);
    }
    let text = std::str::from_utf8(data).map_err(|_| DecodeError::Decode)?;
    // usvg's own settings: DTDs allowed (roxmltree limits entity expansion).
    let xml_options = roxmltree::ParsingOptions {
        allow_dtd: true,
        ..Default::default()
    };
    let xml = roxmltree::Document::parse_with_options(text, xml_options).map_err(|_| DecodeError::Decode)?;
    if too_deep(&xml) {
        return Err(DecodeError::Decode);
    }
    let options = Options {
        fontdb: fonts(),
        image_href_resolver: ImageHrefResolver {
            resolve_data: ImageHrefResolver::default_data_resolver(),
            // Not a file path, not a URL: links out of the file are ignored.
            resolve_string: Box::new(|_, _| None),
        },
        ..Options::default()
    };
    let tree = Tree::from_xmltree(&xml, &options).map_err(|_| DecodeError::Decode)?;
    let size = tree.size().to_int_size();
    let (width, height) = (size.width(), size.height());
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(DecodeError::Decode);
    }
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height).ok_or(DecodeError::Decode)?;
    resvg::render(&tree, resvg::tiny_skia::Transform::default(), &mut pixmap.as_mut());
    let mut rgba = pixmap.take();
    for pixel in rgba.chunks_exact_mut(4) {
        let alpha = u32::from(pixel[3]);
        if alpha != 0 && alpha != 255 {
            for value in &mut pixel[..3] {
                *value = ((u32::from(*value) * 255 + alpha / 2) / alpha).min(255) as u8;
            }
        }
    }
    let rgba = RgbaImage::from_raw(width, height, rgba).ok_or(DecodeError::Decode)?;
    Ok(DynamicImage::ImageRgba8(rgba))
}

/// The system's fonts, loaded on the first SVG and kept for the process.
/// Generic families (serif, sans-serif, monospace) map to the first of a few
/// common fonts that is installed. Text with no matching font is skipped.
fn fonts() -> Arc<fontdb::Database> {
    static FONTS: OnceLock<Arc<fontdb::Database>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let mut fonts = fontdb::Database::new();
            fonts.load_system_fonts();
            let installed = |names: &[&'static str]| {
                names.iter().copied().find(|&name| {
                    fonts.faces().any(|face| face.families.iter().any(|(family, _)| family == name))
                })
            };
            let serif = installed(&["Times New Roman", "Liberation Serif", "DejaVu Serif", "Noto Serif"]);
            let sans = installed(&["Arial", "Helvetica", "Liberation Sans", "DejaVu Sans", "Noto Sans"]);
            let mono = installed(&["Courier New", "Menlo", "Liberation Mono", "DejaVu Sans Mono", "Noto Sans Mono"]);
            if let Some(name) = serif {
                fonts.set_serif_family(name);
            }
            if let Some(name) = sans {
                fonts.set_sans_serif_family(name);
            }
            if let Some(name) = mono {
                fonts.set_monospace_family(name);
            }
            Arc::new(fonts)
        })
        .clone()
}

fn too_deep(xml: &roxmltree::Document) -> bool {
    // Nodes come in document order, so a parent's depth is known before its
    // children's.
    let mut depths = Vec::new();
    for node in xml.descendants() {
        let depth = node.parent().map_or(0, |parent| depths[parent.id().get_usize()] + 1);
        if depth > MAX_DEPTH {
            return true;
        }
        depths.push(depth);
    }
    false
}

/// Where a doctype ends, after its internal subset if it has one.
fn doctype_end(data: &[u8]) -> Option<usize> {
    let mut in_subset = false;
    for (index, &byte) in data.iter().enumerate() {
        match byte {
            b'[' => in_subset = true,
            b']' => in_subset = false,
            b'>' if !in_subset => return Some(index + 1),
            _ => {}
        }
    }
    None
}

fn find(data: &[u8], end: &[u8]) -> Option<usize> {
    data.windows(end.len()).position(|window| window == end).map(|index| index + end.len())
}
