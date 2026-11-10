//! Opens every file in native/corpus/corpus.toml and checks it against what
//! the manifest says. Images go through the core's C API, both as a still
//! and frame by frame; videos through libmpv, as the core's player does (the
//! machine's libmpv for now).
//!
//!   cargo test --release --test corpus

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::ptr;

use pixvitta_core::{
    pv_animation_next_frame, pv_animation_open, pv_animation_release, pv_image_decode, pv_image_release, PvAnimation,
    PvImage, PV_OK,
};

fn corpus() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../corpus")
}

/// Leading fields of `pv_image` in pixvitta.h.
#[repr(C)]
struct ImageView {
    width: u32,
    height: u32,
    stride: u32,
    pixels: *const u8,
}

struct Picture {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

/// Copies the pixels out of a `pv_image` and releases it.
unsafe fn take(image: *mut PvImage) -> Picture {
    let view = &*(image as *const ImageView);
    let (width, height) = (view.width, view.height);
    let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
    for row in 0..height as usize {
        let start = view.pixels.add(row * view.stride as usize);
        rgba.extend_from_slice(std::slice::from_raw_parts(start, width as usize * 4));
    }
    pv_image_release(image);
    Picture { width, height, rgba }
}

fn check_image(path: &CStr, sample: &toml::Table) -> Result<(), String> {
    let mut image: *mut PvImage = ptr::null_mut();
    let status = unsafe { pv_image_decode(path.as_ptr(), &mut image) };
    if status != PV_OK {
        return Err(format!("does not open (error {status})"));
    }
    let picture = unsafe { take(image) };
    check_size(picture.width as i64, picture.height as i64, sample)?;
    if let Some(reference) = sample.get("reference").and_then(|value| value.as_str()) {
        check_pixels(&picture, reference, sample)?;
    }
    check_frames(path, sample)
}

/// Plays the file through the animation API: each frame's duration and
/// pixels, then that it starts again from the first. Samples without
/// `frames` must be a single frame with duration 0.
fn check_frames(path: &CStr, sample: &toml::Table) -> Result<(), String> {
    let durations: Vec<i64> = match sample.get("frames").and_then(|value| value.as_array()) {
        Some(frames) => frames.iter().filter_map(|value| value.as_integer()).collect(),
        None => vec![0],
    };
    let references = sample.get("frame_references").and_then(|value| value.as_array());
    let mut animation: *mut PvAnimation = ptr::null_mut();
    let status = unsafe { pv_animation_open(path.as_ptr(), &mut animation) };
    if status != PV_OK {
        return Err(format!("does not open as an animation (error {status})"));
    }
    let next = || {
        let (mut image, mut duration): (*mut PvImage, u32) = (ptr::null_mut(), 0);
        let status = unsafe { pv_animation_next_frame(animation, &mut image, &mut duration) };
        if status != PV_OK {
            return Err(format!("frame does not decode (error {status})"));
        }
        Ok((unsafe { take(image) }, duration))
    };
    let result = (|| {
        let mut first = None;
        for (index, &expected) in durations.iter().enumerate() {
            let (picture, duration) = next()?;
            if i64::from(duration) != expected {
                return Err(format!("frame {index} lasts {duration} ms, expected {expected}"));
            }
            check_size(picture.width as i64, picture.height as i64, sample)?;
            let reference = references.and_then(|references| references.get(index)?.as_str());
            if let Some(reference) = reference {
                check_pixels(&picture, reference, sample).map_err(|error| format!("frame {index}: {error}"))?;
            }
            first.get_or_insert(picture);
        }
        if durations != [0] {
            let (picture, duration) = next()?;
            if i64::from(duration) != durations[0] || first.is_none_or(|first| first.rgba != picture.rgba) {
                let count = durations.len();
                return Err(format!("frame {count} is not the first again; expected {count} frames"));
            }
        }
        Ok(())
    })();
    unsafe { pv_animation_release(animation) };
    result
}

fn check_pixels(picture: &Picture, reference: &str, sample: &toml::Table) -> Result<(), String> {
    let expected = image::open(corpus().join("references").join(reference))
        .map_err(|error| format!("reference {reference}: {error}"))?
        .to_rgba8();
    if expected.dimensions() != (picture.width, picture.height) {
        return Err(format!("reference {reference} is a different size"));
    }
    // Mean difference per channel, with colour weighted by alpha so what is
    // under transparent pixels doesn't count.
    let premultiply = |pixel: &[u8]| {
        let alpha = pixel[3] as f64 / 255.0;
        [pixel[0] as f64 * alpha, pixel[1] as f64 * alpha, pixel[2] as f64 * alpha, pixel[3] as f64]
    };
    let total: f64 = picture
        .rgba
        .chunks_exact(4)
        .zip(expected.as_raw().chunks_exact(4))
        .map(|(a, b)| {
            let (a, b) = (premultiply(a), premultiply(b));
            (0..4).map(|channel| (a[channel] - b[channel]).abs()).sum::<f64>()
        })
        .sum();
    let error = total / picture.rgba.len() as f64;
    let max_error = number(sample, "max_error").unwrap_or(3.0);
    if error > max_error {
        return Err(format!("pixels differ from {reference} by {error:.2} (max {max_error})"));
    }
    Ok(())
}

fn check_size(width: i64, height: i64, sample: &toml::Table) -> Result<(), String> {
    let expected = (number(sample, "width").unwrap_or(0.0) as i64, number(sample, "height").unwrap_or(0.0) as i64);
    if (width, height) != expected {
        return Err(format!("{width}x{height}, expected {}x{}", expected.0, expected.1));
    }
    Ok(())
}

fn number(sample: &toml::Table, key: &str) -> Option<f64> {
    let value = sample.get(key)?;
    value.as_float().or_else(|| value.as_integer().map(|integer| integer as f64))
}

// Video: just enough of libmpv to load a file and read its properties.

#[repr(C)]
struct MpvEvent {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

#[link(name = "mpv")]
extern "C" {
    fn mpv_create() -> *mut c_void;
    fn mpv_initialize(handle: *mut c_void) -> c_int;
    fn mpv_terminate_destroy(handle: *mut c_void);
    fn mpv_set_option_string(handle: *mut c_void, name: *const c_char, value: *const c_char) -> c_int;
    fn mpv_command(handle: *mut c_void, args: *mut *const c_char) -> c_int;
    fn mpv_get_property(handle: *mut c_void, name: *const c_char, format: c_int, data: *mut c_void) -> c_int;
    fn mpv_wait_event(handle: *mut c_void, timeout: f64) -> *mut MpvEvent;
}

const MPV_EVENT_NONE: c_int = 0;
const MPV_EVENT_END_FILE: c_int = 7;
const MPV_EVENT_FILE_LOADED: c_int = 8;
const MPV_FORMAT_INT64: c_int = 4;
const MPV_FORMAT_DOUBLE: c_int = 5;

fn check_video(path: &CStr, sample: &toml::Table) -> Result<(), String> {
    unsafe {
        let mpv = mpv_create();
        for (name, value) in [(c"config", c"no"), (c"vo", c"null"), (c"ao", c"null"), (c"pause", c"yes")] {
            mpv_set_option_string(mpv, name.as_ptr(), value.as_ptr());
        }
        mpv_initialize(mpv);
        let mut args = [c"loadfile".as_ptr(), path.as_ptr(), ptr::null()];
        mpv_command(mpv, args.as_mut_ptr());
        // A timeout here means libmpv went quiet, not a pause in the test.
        let loaded = loop {
            match (*mpv_wait_event(mpv, 20.0)).event_id {
                MPV_EVENT_FILE_LOADED => break true,
                MPV_EVENT_END_FILE | MPV_EVENT_NONE => break false,
                _ => {}
            }
        };
        let (mut width, mut height, mut duration) = (0i64, 0i64, 0f64);
        mpv_get_property(mpv, c"width".as_ptr(), MPV_FORMAT_INT64, &mut width as *mut _ as *mut c_void);
        mpv_get_property(mpv, c"height".as_ptr(), MPV_FORMAT_INT64, &mut height as *mut _ as *mut c_void);
        mpv_get_property(mpv, c"duration".as_ptr(), MPV_FORMAT_DOUBLE, &mut duration as *mut _ as *mut c_void);
        mpv_terminate_destroy(mpv);

        if !loaded {
            return Err("libmpv does not open it".into());
        }
        check_size(width, height, sample)?;
        let expected = number(sample, "duration").unwrap_or(0.0);
        if (duration - expected).abs() > 0.15 {
            return Err(format!("{duration:.2} s, expected {expected} s"));
        }
        Ok(())
    }
}

fn main() -> ExitCode {
    // libmpv needs the C numeric locale, which a Rust process already has.
    let manifest = std::fs::read_to_string(corpus().join("corpus.toml")).expect("native/corpus/corpus.toml");
    let manifest: toml::Table = manifest.parse().expect("corpus.toml is not valid TOML");
    let samples = manifest["sample"].as_array().expect("corpus.toml has no [[sample]]");

    let (mut passed, mut expected_failures, mut problems) = (0, 0, Vec::new());
    for sample in samples {
        let sample = sample.as_table().expect("[[sample]] is a table");
        let file = sample["file"].as_str().expect("sample without file");
        let path = CString::new(corpus().join("samples").join(file).into_os_string().into_encoded_bytes()).unwrap();
        let result = if file.starts_with("video/") {
            check_video(&path, sample)
        } else {
            check_image(&path, sample)
        };
        let expected_failure = sample.get("expected_failure").and_then(|value| value.as_str());
        match (result, expected_failure) {
            (Ok(()), None) => {
                passed += 1;
                println!("pass      {file}");
            }
            (Err(error), Some(reason)) => {
                expected_failures += 1;
                println!("expected  {file}: {reason} ({error})");
            }
            (Err(error), None) => {
                println!("FAIL      {file}: {error}");
                problems.push(file.to_string());
            }
            (Ok(()), Some(_)) => {
                println!("FIXED     {file}: passes now; remove its expected_failure");
                problems.push(file.to_string());
            }
        }
        if let Some(note) = sample.get("note").and_then(|value| value.as_str()) {
            println!("          note: {note}");
        }
    }
    println!("\n{passed} passed, {expected_failures} expected failures, {} unexpected", problems.len());
    if problems.is_empty() {
        ExitCode::SUCCESS
    } else {
        println!("unexpected: {}", problems.join(", "));
        ExitCode::FAILURE
    }
}
