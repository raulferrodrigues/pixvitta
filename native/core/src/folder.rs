//! Folder source: the top level of one directory, in natural name order.
//! Same rules as the Electron app's scanner: hidden files are skipped and
//! symlinks are followed to regular files.
//!
//! Files are recognised by extension for now. The plan detects them by
//! content; that comes later.

use std::cmp::Ordering;
use std::ffi::CString;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Image = 1,
    Video = 2,
}

pub struct Entry {
    /// NUL-terminated path bytes, handed to C as they are.
    pub path: CString,
    pub kind: Kind,
}

// Only what `image.rs` decodes today. The full list comes with the corpus.
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "ico", "avif"];
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "m4v", "mov", "webm", "ogv", "mkv", "avi"];

fn kind_of(path: &Path) -> Option<Kind> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        Some(Kind::Image)
    } else if VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        Some(Kind::Video)
    } else {
        None
    }
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
            let kind = kind_of(&path)?;
            // fs::metadata follows symlinks; broken links and links to
            // directories drop out here.
            if !std::fs::metadata(&path).ok()?.is_file() {
                return None;
            }
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
