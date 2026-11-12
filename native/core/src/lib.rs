//! Pixvitta core. Everything here is reached through the C API declared in
//! `include/pixvitta.h`; keep the two in sync.
//!
//! The API follows libmpv's two rules:
//! - The core owns every buffer it hands out, and the caller gives it back
//!   with the matching release call.
//! - The core never calls into the UI from its own threads, except for the
//!   one wake-up callback (`pv_player_set_wakeup_callback`).

// Safety contracts for the exported functions are in pixvitta.h.
#![allow(clippy::missing_safety_doc)]

mod av1;
mod folder;
mod heif;
mod image;
mod jxl;
mod mpv;
mod player;
mod sniff;
mod svg;

use std::ffi::{c_char, c_int, c_void, CStr};
use std::os::unix::ffi::OsStrExt;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::ptr;

pub const PV_OK: c_int = 0;
pub const PV_ERROR_INVALID_ARGUMENT: c_int = -1;
pub const PV_ERROR_IO: c_int = -2;
pub const PV_ERROR_UNSUPPORTED: c_int = -3;
pub const PV_ERROR_DECODE: c_int = -4;
pub const PV_ERROR_MPV: c_int = -5;

#[no_mangle]
pub extern "C" fn pv_error_string(code: c_int) -> *const c_char {
    let message: &'static CStr = match code {
        PV_OK => c"success",
        PV_ERROR_INVALID_ARGUMENT => c"invalid argument",
        PV_ERROR_IO => c"could not read the file or folder",
        PV_ERROR_UNSUPPORTED => c"unsupported format",
        PV_ERROR_DECODE => c"could not decode the file",
        PV_ERROR_MPV => c"libmpv error",
        _ => c"unknown error",
    };
    message.as_ptr()
}

/// Runs the body of a call that opens or decodes a file. A panic in it, from
/// a decoder on a malformed file, becomes PV_ERROR_DECODE instead of
/// unwinding into C.
fn catching_panics(call: impl FnOnce() -> c_int) -> c_int {
    catch_unwind(AssertUnwindSafe(call)).unwrap_or(PV_ERROR_DECODE)
}

unsafe fn path_from<'a>(path: *const c_char) -> Option<&'a Path> {
    if path.is_null() {
        return None;
    }
    Some(Path::new(std::ffi::OsStr::from_bytes(CStr::from_ptr(path).to_bytes())))
}

// Folders

pub struct PvFolder {
    entries: Vec<folder::Entry>,
}

#[no_mangle]
pub unsafe extern "C" fn pv_folder_open(path: *const c_char, out: *mut *mut PvFolder) -> c_int {
    if out.is_null() {
        return PV_ERROR_INVALID_ARGUMENT;
    }
    *out = ptr::null_mut();
    let Some(path) = path_from(path) else {
        return PV_ERROR_INVALID_ARGUMENT;
    };
    catching_panics(|| match folder::scan(path) {
        Ok(entries) => {
            *out = Box::into_raw(Box::new(PvFolder { entries }));
            PV_OK
        }
        Err(_) => PV_ERROR_IO,
    })
}

#[no_mangle]
pub unsafe extern "C" fn pv_folder_count(folder: *const PvFolder) -> usize {
    folder.as_ref().map_or(0, |folder| folder.entries.len())
}

#[no_mangle]
pub unsafe extern "C" fn pv_folder_path(folder: *const PvFolder, index: usize) -> *const c_char {
    folder
        .as_ref()
        .and_then(|folder| folder.entries.get(index))
        .map_or(ptr::null(), |entry| entry.path.as_ptr())
}

#[no_mangle]
pub unsafe extern "C" fn pv_folder_kind(folder: *const PvFolder, index: usize) -> c_int {
    folder
        .as_ref()
        .and_then(|folder| folder.entries.get(index))
        .map_or(0, |entry| entry.kind as c_int)
}

#[no_mangle]
pub unsafe extern "C" fn pv_folder_release(folder: *mut PvFolder) {
    if !folder.is_null() {
        drop(Box::from_raw(folder));
    }
}

// Images

/// The layout is part of the C API (`pv_image` in pixvitta.h). The pixel
/// vector stays behind the public fields so release can free it.
#[repr(C)]
pub struct PvImage {
    width: u32,
    height: u32,
    stride: u32,
    pixels: *const u8,
    storage: Vec<u8>,
}

#[no_mangle]
pub unsafe extern "C" fn pv_image_decode(path: *const c_char, out: *mut *mut PvImage) -> c_int {
    if out.is_null() {
        return PV_ERROR_INVALID_ARGUMENT;
    }
    *out = ptr::null_mut();
    let Some(path) = path_from(path) else {
        return PV_ERROR_INVALID_ARGUMENT;
    };
    catching_panics(|| match image::decode(path) {
        Ok(decoded) => {
            *out = image_from(decoded);
            PV_OK
        }
        Err(error) => decode_error(error),
    })
}

fn image_from(decoded: image::Decoded) -> *mut PvImage {
    let mut result = Box::new(PvImage {
        width: decoded.width,
        height: decoded.height,
        stride: decoded.width * 4,
        pixels: ptr::null(),
        storage: decoded.rgba,
    });
    result.pixels = result.storage.as_ptr();
    Box::into_raw(result)
}

fn decode_error(error: image::DecodeError) -> c_int {
    match error {
        image::DecodeError::Io => PV_ERROR_IO,
        image::DecodeError::Unsupported => PV_ERROR_UNSUPPORTED,
        image::DecodeError::Decode => PV_ERROR_DECODE,
    }
}

#[no_mangle]
pub unsafe extern "C" fn pv_image_release(image: *mut PvImage) {
    if !image.is_null() {
        drop(Box::from_raw(image));
    }
}

// Animations

pub struct PvAnimation {
    animation: image::Animation,
    /// Set when decoding a frame panicked; the decoder may be half updated,
    /// so it is never used again.
    broken: bool,
}

#[no_mangle]
pub unsafe extern "C" fn pv_animation_open(path: *const c_char, out: *mut *mut PvAnimation) -> c_int {
    if out.is_null() {
        return PV_ERROR_INVALID_ARGUMENT;
    }
    *out = ptr::null_mut();
    let Some(path) = path_from(path) else {
        return PV_ERROR_INVALID_ARGUMENT;
    };
    catching_panics(|| match image::Animation::open(path) {
        Ok(animation) => {
            *out = Box::into_raw(Box::new(PvAnimation { animation, broken: false }));
            PV_OK
        }
        Err(error) => decode_error(error),
    })
}

#[no_mangle]
pub unsafe extern "C" fn pv_animation_next_frame(
    animation: *mut PvAnimation,
    out: *mut *mut PvImage,
    duration_ms: *mut u32,
) -> c_int {
    if out.is_null() || duration_ms.is_null() {
        return PV_ERROR_INVALID_ARGUMENT;
    }
    *out = ptr::null_mut();
    *duration_ms = 0;
    let Some(animation) = animation.as_mut() else {
        return PV_ERROR_INVALID_ARGUMENT;
    };
    if animation.broken {
        return PV_ERROR_DECODE;
    }
    // Stays set only if next_frame panics.
    animation.broken = true;
    catching_panics(|| {
        let frame = animation.animation.next_frame();
        animation.broken = false;
        match frame {
            Ok((decoded, duration)) => {
                *out = image_from(decoded);
                *duration_ms = duration;
                PV_OK
            }
            Err(error) => decode_error(error),
        }
    })
}

#[no_mangle]
pub unsafe extern "C" fn pv_animation_release(animation: *mut PvAnimation) {
    if !animation.is_null() {
        drop(Box::from_raw(animation));
    }
}

// Video

pub struct PvPlayer(player::Player);
pub struct PvVideoRenderer(player::Renderer);

#[no_mangle]
pub unsafe extern "C" fn pv_player_create(out: *mut *mut PvPlayer) -> c_int {
    if out.is_null() {
        return PV_ERROR_INVALID_ARGUMENT;
    }
    *out = ptr::null_mut();
    match player::Player::new() {
        Some(player) => {
            *out = Box::into_raw(Box::new(PvPlayer(player)));
            PV_OK
        }
        None => PV_ERROR_MPV,
    }
}

#[no_mangle]
pub unsafe extern "C" fn pv_player_destroy(player: *mut PvPlayer) {
    if !player.is_null() {
        drop(Box::from_raw(player));
    }
}

#[no_mangle]
pub unsafe extern "C" fn pv_player_set_wakeup_callback(
    player: *mut PvPlayer,
    callback: Option<player::WakeupCallback>,
    ctx: *mut c_void,
) {
    if let Some(player) = player.as_ref() {
        player.0.set_wakeup(callback, ctx);
    }
}

fn status(ok: bool) -> c_int {
    if ok {
        PV_OK
    } else {
        PV_ERROR_MPV
    }
}

#[no_mangle]
pub unsafe extern "C" fn pv_player_load(player: *mut PvPlayer, path: *const c_char) -> c_int {
    match (player.as_ref(), path.is_null()) {
        (Some(player), false) => status(player.0.load(CStr::from_ptr(path))),
        _ => PV_ERROR_INVALID_ARGUMENT,
    }
}

#[no_mangle]
pub unsafe extern "C" fn pv_player_stop(player: *mut PvPlayer) -> c_int {
    player
        .as_ref()
        .map_or(PV_ERROR_INVALID_ARGUMENT, |player| status(player.0.stop()))
}

#[no_mangle]
pub unsafe extern "C" fn pv_player_set_paused(player: *mut PvPlayer, paused: bool) -> c_int {
    player
        .as_ref()
        .map_or(PV_ERROR_INVALID_ARGUMENT, |player| status(player.0.set_paused(paused)))
}

#[no_mangle]
pub unsafe extern "C" fn pv_video_renderer_create(
    player: *mut PvPlayer,
    get_proc_address: Option<mpv::GetProcAddress>,
    get_proc_address_ctx: *mut c_void,
    out: *mut *mut PvVideoRenderer,
) -> c_int {
    if out.is_null() {
        return PV_ERROR_INVALID_ARGUMENT;
    }
    *out = ptr::null_mut();
    let (Some(player), Some(get_proc_address)) = (player.as_ref(), get_proc_address) else {
        return PV_ERROR_INVALID_ARGUMENT;
    };
    match player.0.create_renderer(get_proc_address, get_proc_address_ctx) {
        Some(renderer) => {
            *out = Box::into_raw(Box::new(PvVideoRenderer(renderer)));
            PV_OK
        }
        None => PV_ERROR_MPV,
    }
}

#[no_mangle]
pub unsafe extern "C" fn pv_video_renderer_render(
    renderer: *mut PvVideoRenderer,
    fbo: c_int,
    width: c_int,
    height: c_int,
    flip_y: bool,
) -> c_int {
    renderer.as_ref().map_or(PV_ERROR_INVALID_ARGUMENT, |renderer| {
        status(renderer.0.render(fbo, width, height, flip_y))
    })
}

#[no_mangle]
pub unsafe extern "C" fn pv_video_renderer_destroy(renderer: *mut PvVideoRenderer) {
    if !renderer.is_null() {
        drop(Box::from_raw(renderer));
    }
}
