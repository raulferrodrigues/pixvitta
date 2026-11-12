//! Folder source: the top level of one directory, in natural name order.
//! Same rules as the Electron app's scanner: hidden files are skipped and
//! symlinks are followed to regular files.
//!
//! A file whose extension is in the image or video list is listed as that
//! kind without being opened. Every other file, with no extension or an
//! unrecognised one, is opened and its first bytes (one read of at most
//! `sniff::HEAD_BYTES`) say whether it is an image or a video
//! (`sniff::listed_kind`). Reading every file's header would cost a seek per
//! file on a hard disk or network share, tens of seconds for a large folder,
//! and nearly every media file has the right extension. The decoder goes by
//! content either way, so a JPEG named `.png` still opens.

use crate::sniff::{self, Kind};
use std::cmp::Ordering;
use std::ffi::CString;
use std::fs::File;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

pub struct Entry {
    /// NUL-terminated path bytes, handed to C as they are.
    pub path: CString,
    pub kind: Kind,
}

// The usual extensions of what the core opens: every format `image.rs`
// decodes, and the video containers the plan lists.
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "ico", "avif", "heic", "heif", "hif", "jxl", "svg", "svgz"];
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "m4v", "mov", "webm", "ogv", "ogg", "mkv", "avi"];

fn kind_by_extension(path: &Path) -> Option<Kind> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        Some(Kind::Image)
    } else if VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        Some(Kind::Video)
    } else {
        None
    }
}

fn kind_by_content(path: &Path) -> Option<Kind> {
    let head = sniff::head(&mut File::open(path).ok()?).ok()?;
    sniff::listed_kind(&head)
}

pub fn scan(folder: &Path) -> std::io::Result<Vec<Entry>> {
    let mut found: Vec<(String, Entry)> = std::fs::read_dir(folder)?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name();
            if name.as_bytes().starts_with(b".") {
                return None;
            }
            let path = entry.path();
            let by_extension = kind_by_extension(&path);
            // fs::metadata follows symlinks; broken links and links to
            // directories drop out here.
            if !std::fs::metadata(&path).ok()?.is_file() {
                return None;
            }
            let kind = by_extension.or_else(|| kind_by_content(&path))?;
            let path = CString::new(path.as_os_str().as_bytes()).ok()?;
            Some((name.to_string_lossy().into_owned(), Entry { path, kind }))
        })
        .collect();
    found.sort_by(|a, b| natural_cmp(&a.0, &b.0));
    Ok(found.into_iter().map(|(_, entry)| entry).collect())
}

/// Case-insensitive natural order, like Intl.Collator with numeric: true, so
/// "2.jpg" sorts before "10.jpg".
fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut left = a.chars().peekable();
    let mut right = b.chars().peekable();
    loop {
        match (left.peek().copied(), right.peek().copied()) {
            (None, None) => return a.cmp(b),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let mut x_digits = String::new();
                while let Some(digit) = left.peek().copied().filter(char::is_ascii_digit) {
                    x_digits.push(digit);
                    left.next();
                }
                let mut y_digits = String::new();
                while let Some(digit) = right.peek().copied().filter(char::is_ascii_digit) {
                    y_digits.push(digit);
                    right.next();
                }
                let x_trimmed = x_digits.trim_start_matches('0');
                let y_trimmed = y_digits.trim_start_matches('0');
                let order = x_trimmed
                    .len()
                    .cmp(&y_trimmed.len())
                    .then_with(|| x_trimmed.cmp(y_trimmed));
                if order != Ordering::Equal {
                    return order;
                }
            }
            (Some(x), Some(y)) => {
                let order = x.to_lowercase().cmp(y.to_lowercase());
                if order != Ordering::Equal {
                    return order;
                }
                left.next();
                right.next();
            }
        }
    }
}
