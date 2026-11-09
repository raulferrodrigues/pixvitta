//! Video playback through libmpv. The core owns the mpv handle; the UI only
//! gets a player to command and a renderer that draws into its OpenGL
//! framebuffer.
//!
//! The mpv core lives until both the player and its renderer are gone, so the
//! UI can drop the player on its main thread and the renderer later on its
//! render thread, in either order. mpv requires the render context to be freed
//! before the core; the shared `Arc` guarantees that.

use crate::mpv;
use std::ffi::{c_char, c_int, c_void, CStr};
use std::ptr;
use std::sync::{Arc, Mutex};

pub type WakeupCallback = unsafe extern "C" fn(ctx: *mut c_void);

struct Core(*mut mpv::Handle);

// libmpv's client API is thread-safe.
unsafe impl Send for Core {}
unsafe impl Sync for Core {}

impl Drop for Core {
    fn drop(&mut self) {
        unsafe { mpv::mpv_terminate_destroy(self.0) };
    }
}

struct Wakeup {
    callback: Option<WakeupCallback>,
    ctx: *mut c_void,
}

unsafe impl Send for Wakeup {}

pub struct Player {
    core: Arc<Core>,
    wakeup: Arc<Mutex<Wakeup>>,
}

pub struct Renderer {
    context: *mut mpv::RenderContext,
    // Kept alive until the render context is freed in `drop`.
    #[allow(dead_code)]
    core: Arc<Core>,
    #[allow(dead_code)]
    wakeup: Arc<Mutex<Wakeup>>,
}

// Options that this libmpv doesn't know are skipped. `config=no` keeps the
// user's mpv.conf and scripts out of the viewer.
const OPTIONS: &[(&CStr, &CStr)] = &[
    (c"config", c"no"),
    (c"load-scripts", c"no"),
    (c"terminal", c"no"),
    (c"input-default-bindings", c"no"),
    (c"osc", c"no"),
    (c"vo", c"libmpv"),
    (c"hwdec", c"auto-safe"),
    (c"idle", c"yes"),
    (c"keep-open", c"yes"),
    (c"loop-file", c"inf"),
];

impl Player {
    pub fn new() -> Option<Player> {
        unsafe {
            let handle = mpv::mpv_create();
            if handle.is_null() {
                return None;
            }
            let core = Arc::new(Core(handle));
            for (name, value) in OPTIONS {
                mpv::mpv_set_option_string(handle, name.as_ptr(), value.as_ptr());
            }
            if mpv::mpv_initialize(handle) < 0 {
                return None;
            }
            Some(Player {
                core,
                wakeup: Arc::new(Mutex::new(Wakeup {
                    callback: None,
                    ctx: ptr::null_mut(),
                })),
            })
        }
    }

    pub fn set_wakeup(&self, callback: Option<WakeupCallback>, ctx: *mut c_void) {
        let mut wakeup = self.wakeup.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        wakeup.callback = callback;
        wakeup.ctx = ctx;
    }

    pub fn load(&self, path: &CStr) -> bool {
        self.set(c"pause", c"no") && self.command(&[c"loadfile", path, c"replace"])
    }

    pub fn stop(&self) -> bool {
        self.command(&[c"stop"])
    }

    pub fn set_paused(&self, paused: bool) -> bool {
        self.set(c"pause", if paused { c"yes" } else { c"no" })
    }

    fn set(&self, name: &CStr, value: &CStr) -> bool {
        unsafe { mpv::mpv_set_property_string(self.core.0, name.as_ptr(), value.as_ptr()) >= 0 }
    }

    fn command(&self, args: &[&CStr]) -> bool {
        let mut pointers: Vec<*const c_char> = args.iter().map(|arg| arg.as_ptr()).collect();
        pointers.push(ptr::null());
        unsafe { mpv::mpv_command(self.core.0, pointers.as_mut_ptr()) >= 0 }
    }

    /// Must run on the UI's render thread with its OpenGL context current.
    pub fn create_renderer(&self, get_proc_address: mpv::GetProcAddress, ctx: *mut c_void) -> Option<Renderer> {
        let mut init = mpv::OpenGlInitParams {
            get_proc_address: Some(get_proc_address),
            get_proc_address_ctx: ctx,
        };
        let mut params = [
            mpv::RenderParam {
                kind: mpv::PARAM_API_TYPE,
                data: mpv::RENDER_API_TYPE_OPENGL.as_ptr() as *mut c_void,
            },
            mpv::RenderParam {
                kind: mpv::PARAM_OPENGL_INIT_PARAMS,
                data: (&mut init as *mut mpv::OpenGlInitParams).cast(),
            },
            mpv::RenderParam {
                kind: mpv::PARAM_INVALID,
                data: ptr::null_mut(),
            },
        ];
        let mut context = ptr::null_mut();
        unsafe {
            if mpv::mpv_render_context_create(&mut context, self.core.0, params.as_mut_ptr()) < 0 || context.is_null() {
                return None;
            }
            // mpv calls this from its own threads. It is the core's one
            // wake-up callback: it carries no data and only asks the UI to
            // redraw. The pointer stays valid because the renderer holds the
            // Arc until the render context is freed.
            let wakeup = Arc::as_ptr(&self.wakeup) as *mut c_void;
            mpv::mpv_render_context_set_update_callback(context, Some(on_render_update), wakeup);
        }
        Some(Renderer {
            context,
            core: Arc::clone(&self.core),
            wakeup: Arc::clone(&self.wakeup),
        })
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        // After this returns, no wake-up reaches the UI, even if the renderer
        // outlives the player.
        self.set_wakeup(None, ptr::null_mut());
        self.stop();
    }
}

unsafe extern "C" fn on_render_update(ctx: *mut c_void) {
    let wakeup = &*(ctx as *const Mutex<Wakeup>);
    let wakeup = wakeup.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(callback) = wakeup.callback {
        callback(wakeup.ctx);
    }
}

impl Renderer {
    /// Draws the current frame into `fbo` (0 is the default framebuffer).
    /// Must run on the render thread with the OpenGL context current.
    pub fn render(&self, fbo: c_int, width: c_int, height: c_int, flip_y: bool) -> bool {
        let mut target = mpv::OpenGlFbo {
            fbo,
            w: width,
            h: height,
            internal_format: 0,
        };
        let mut flip: c_int = flip_y.into();
        let mut params = [
            mpv::RenderParam {
                kind: mpv::PARAM_OPENGL_FBO,
                data: (&mut target as *mut mpv::OpenGlFbo).cast(),
            },
            mpv::RenderParam {
                kind: mpv::PARAM_FLIP_Y,
                data: (&mut flip as *mut c_int).cast(),
            },
            mpv::RenderParam {
                kind: mpv::PARAM_INVALID,
                data: ptr::null_mut(),
            },
        ];
        unsafe {
            mpv::mpv_render_context_update(self.context);
            mpv::mpv_render_context_render(self.context, params.as_mut_ptr()) >= 0
        }
    }
}

impl Drop for Renderer {
    fn drop(&mut self) {
        // Runs before the fields drop, so the mpv core outlives its render
        // context, as libmpv requires.
        unsafe { mpv::mpv_render_context_free(self.context) };
    }
}
