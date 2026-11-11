/*
 * Pixvitta core C API.
 *
 * Two rules, taken from libmpv:
 * - The core owns every buffer it hands out. Give each one back with its
 *   release call (pv_folder_release, pv_image_release, ...).
 * - The core never calls into the UI from its own threads, except for the
 *   one wake-up callback set with pv_player_set_wakeup_callback.
 *
 * Paths are NUL-terminated byte strings, passed through to the file system
 * unchanged. They are not required to be UTF-8.
 *
 * Functions that can fail return PV_OK or a negative PV_ERROR_* code.
 */
#ifndef PIXVITTA_H
#define PIXVITTA_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
    PV_OK = 0,
    PV_ERROR_INVALID_ARGUMENT = -1,
    PV_ERROR_IO = -2,
    PV_ERROR_UNSUPPORTED = -3,
    PV_ERROR_DECODE = -4,
    PV_ERROR_MPV = -5,
};

/* A static string. Never free it. */
const char *pv_error_string(int code);

/* Folders ---------------------------------------------------------------- */

typedef enum pv_media_kind {
    PV_MEDIA_IMAGE = 1,
    PV_MEDIA_VIDEO = 2,
} pv_media_kind;

typedef struct pv_folder pv_folder;

/* Lists the media files at the top level of a folder, in natural name order.
 * Hidden files are skipped. The list is a snapshot; it does not follow
 * changes on disk. */
int pv_folder_open(const char *path, pv_folder **out);
size_t pv_folder_count(const pv_folder *folder);
/* Owned by the folder; valid until pv_folder_release. NULL out of range. */
const char *pv_folder_path(const pv_folder *folder, size_t index);
/* A pv_media_kind, or 0 out of range. */
int pv_folder_kind(const pv_folder *folder, size_t index);
void pv_folder_release(pv_folder *folder);

/* Images ----------------------------------------------------------------- */

/* Decoded pixels: 8-bit RGBA, sRGB, straight (not premultiplied) alpha, top
 * row first, with EXIF orientation already applied. Read-only. */
typedef struct pv_image {
    uint32_t width;
    uint32_t height;
    uint32_t stride; /* bytes per row */
    const uint8_t *pixels;
} pv_image;

/* Decodes a still image (the first frame of an animated one). Safe to call
 * from any thread. */
int pv_image_decode(const char *path, pv_image **out);
/* Frees the pixels. Call it from any thread once the UI is done with them. */
void pv_image_release(pv_image *image);

/* Animations ------------------------------------------------------------- */

/* Plays an image frame by frame. Animated GIF and WebP have their frames;
 * any other image is a still with a single frame. Frames are decoded one at
 * a time as they are asked for, so an animation's memory doesn't grow with
 * its length. */
typedef struct pv_animation pv_animation;

/* Opens any image the core can decode. Safe to call from any thread. */
int pv_animation_open(const char *path, pv_animation **out);
/* Decodes the next frame, as a whole composited picture in the same pixel
 * format as pv_image_decode. After the last frame it starts again from the
 * first, forever; the file's own loop count is ignored. *duration_ms is how
 * long to show the frame; it is 0 when the file has a single frame (a still
 * image), which means there is nothing more to ask for. A duration of 10 ms
 * or less in the file is reported as 100 ms, as browsers do. Release each
 * frame with pv_image_release; frames may outlive the animation. One thread
 * at a time per animation. If the decoder panics, this and every later call
 * on the animation return PV_ERROR_DECODE; it can still be released. */
int pv_animation_next_frame(pv_animation *animation, pv_image **out, uint32_t *duration_ms);
/* Call it from any thread, but not while a pv_animation_next_frame call on
 * the same animation is running. */
void pv_animation_release(pv_animation *animation);

/* Video ------------------------------------------------------------------ */

typedef struct pv_player pv_player;
typedef struct pv_video_renderer pv_video_renderer;

/* libmpv needs LC_NUMERIC set to "C"; set it before creating a player. */
int pv_player_create(pv_player **out);
/* Stops playback. No wake-up callback runs once this returns. A renderer
 * created from the player stays valid until pv_video_renderer_destroy. */
void pv_player_destroy(pv_player *player);

/* Called from any thread, including the core's own, when the UI should wake
 * up; for now that only means a new video frame is ready to draw. It must
 * return quickly and must not call into the core: schedule the work on the
 * UI's own thread instead. NULL removes the callback. */
typedef void (*pv_wakeup_fn)(void *ctx);
void pv_player_set_wakeup_callback(pv_player *player, pv_wakeup_fn callback, void *ctx);

/* Starts playing a file from the beginning, unpaused, looping. */
int pv_player_load(pv_player *player, const char *path);
int pv_player_stop(pv_player *player);
int pv_player_set_paused(pv_player *player, bool paused);

/* Video is drawn with OpenGL into the UI's own framebuffer. The three
 * renderer calls must run on the UI's render thread with its OpenGL context
 * current. */
typedef void *(*pv_get_proc_address_fn)(void *ctx, const char *name);
int pv_video_renderer_create(pv_player *player, pv_get_proc_address_fn get_proc_address,
                             void *get_proc_address_ctx, pv_video_renderer **out);
/* Draws the current frame into framebuffer `fbo` (0 for the default one) at
 * width x height pixels. */
int pv_video_renderer_render(pv_video_renderer *renderer, int fbo, int width, int height,
                             bool flip_y);
void pv_video_renderer_destroy(pv_video_renderer *renderer);

#ifdef __cplusplus
}
#endif

#endif
