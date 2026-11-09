//! Hand-written bindings for the part of libmpv the core uses: the client
//! API and the OpenGL render API. The final link against libmpv happens in
//! the app that links this static library.

use std::ffi::{c_char, c_int, c_void};

#[repr(C)]
pub struct Handle {
    private: [u8; 0],
}

#[repr(C)]
pub struct RenderContext {
    private: [u8; 0],
}

#[repr(C)]
pub struct RenderParam {
    pub kind: c_int,
    pub data: *mut c_void,
}

pub type GetProcAddress = unsafe extern "C" fn(ctx: *mut c_void, name: *const c_char) -> *mut c_void;

#[repr(C)]
pub struct OpenGlInitParams {
    pub get_proc_address: Option<GetProcAddress>,
    pub get_proc_address_ctx: *mut c_void,
}

#[repr(C)]
pub struct OpenGlFbo {
    pub fbo: c_int,
    pub w: c_int,
    pub h: c_int,
    pub internal_format: c_int,
}

pub const PARAM_INVALID: c_int = 0;
pub const PARAM_API_TYPE: c_int = 1;
pub const PARAM_OPENGL_INIT_PARAMS: c_int = 2;
pub const PARAM_OPENGL_FBO: c_int = 3;
pub const PARAM_FLIP_Y: c_int = 4;

pub const RENDER_API_TYPE_OPENGL: &std::ffi::CStr = c"opengl";

extern "C" {
    pub fn mpv_create() -> *mut Handle;
    pub fn mpv_initialize(handle: *mut Handle) -> c_int;
    pub fn mpv_terminate_destroy(handle: *mut Handle);
    pub fn mpv_set_option_string(handle: *mut Handle, name: *const c_char, data: *const c_char) -> c_int;
    pub fn mpv_set_property_string(handle: *mut Handle, name: *const c_char, data: *const c_char) -> c_int;
    pub fn mpv_command(handle: *mut Handle, args: *mut *const c_char) -> c_int;
    pub fn mpv_render_context_create(
        out: *mut *mut RenderContext,
        handle: *mut Handle,
        params: *mut RenderParam,
    ) -> c_int;
    pub fn mpv_render_context_set_update_callback(
        ctx: *mut RenderContext,
        callback: Option<unsafe extern "C" fn(*mut c_void)>,
        callback_ctx: *mut c_void,
    );
    pub fn mpv_render_context_update(ctx: *mut RenderContext) -> u64;
    pub fn mpv_render_context_render(ctx: *mut RenderContext, params: *mut RenderParam) -> c_int;
    pub fn mpv_render_context_free(ctx: *mut RenderContext);
}
