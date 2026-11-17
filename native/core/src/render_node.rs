//! Finds the DRM render node (`/dev/dri/renderD*`) of the GPU the UI's
//! OpenGL context runs on, so libmpv's VA-API decoder uses the same GPU and
//! can hand it frames without copying. Linux only.
//!
//! Only an EGL context can say which GPU it is on, and only an EGL context
//! can take VA-API frames without a copy. Under GLX there is nothing to do:
//! mpv opens a render node itself for `vaapi-copy`.

use std::ffi::{c_char, c_void, CStr};
use std::fs::{File, OpenOptions};
use std::path::PathBuf;

type Display = *mut c_void;
type Device = *mut c_void;
type Attrib = isize;

const EGL_NO_DISPLAY: Display = std::ptr::null_mut();
const EGL_EXTENSIONS: i32 = 0x3055;
const EGL_DEVICE_EXT: i32 = 0x322C;
const EGL_DRM_RENDER_NODE_FILE_EXT: i32 = 0x3377;

type QueryDisplayAttrib = unsafe extern "C" fn(Display, i32, *mut Attrib) -> u32;
type QueryDeviceString = unsafe extern "C" fn(Device, i32) -> *const c_char;

extern "C" {
    fn eglGetCurrentContext() -> *mut c_void;
    fn eglGetCurrentDisplay() -> Display;
    fn eglQueryString(display: Display, name: i32) -> *const c_char;
    fn eglGetProcAddress(name: *const c_char) -> *mut c_void;
}

/// Opens the render node of the current EGL context's GPU. None when the
/// current context isn't EGL, or the driver can't name its render node.
/// Must run with the UI's OpenGL context current.
pub fn open_current() -> Option<File> {
    // Rust opens files close-on-exec, so it doesn't leak into children.
    OpenOptions::new().read(true).write(true).open(current_path()?).ok()
}

fn current_path() -> Option<PathBuf> {
    unsafe {
        if eglGetCurrentContext().is_null() {
            return None;
        }
        // Client extensions, which EGL_EXT_device_base implies.
        let client = eglQueryString(EGL_NO_DISPLAY, EGL_EXTENSIONS);
        if !has_extension(client, "EGL_EXT_device_query") && !has_extension(client, "EGL_EXT_device_base") {
            return None;
        }
        let query_display: QueryDisplayAttrib =
            std::mem::transmute(non_null(eglGetProcAddress(c"eglQueryDisplayAttribEXT".as_ptr()))?);
        let query_device: QueryDeviceString =
            std::mem::transmute(non_null(eglGetProcAddress(c"eglQueryDeviceStringEXT".as_ptr()))?);
        let mut device: Attrib = 0;
        if query_display(eglGetCurrentDisplay(), EGL_DEVICE_EXT, &mut device) == 0 || device == 0 {
            return None;
        }
        let device = device as Device;
        if !has_extension(query_device(device, EGL_EXTENSIONS), "EGL_EXT_device_drm_render_node") {
            return None;
        }
        let path = query_device(device, EGL_DRM_RENDER_NODE_FILE_EXT);
        if path.is_null() {
            return None;
        }
        Some(CStr::from_ptr(path).to_str().ok()?.into())
    }
}

unsafe fn has_extension(list: *const c_char, name: &str) -> bool {
    !list.is_null() && CStr::from_ptr(list).to_string_lossy().split(' ').any(|ext| ext == name)
}

fn non_null(pointer: *mut c_void) -> Option<*mut c_void> {
    (!pointer.is_null()).then_some(pointer)
}
