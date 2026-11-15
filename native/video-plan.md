# Video plan

Tracks the video work in the native app: bundling libmpv and FFmpeg first,
then player parity with the Electron app. Decisions are recorded here with
their trade-offs as they are made; remove this file, or fold what is left
into [`future-work.md`](future-work.md), when the work is done.

## Status

The whole video stack builds from `core/vendor/` and links into the core,
always: there is no build that uses the system's libmpv or FFmpeg. The
corpus check passes through it, AV1 included, and the Linux app builds and
starts. Video has not been watched on a screen with it yet.

## What is bundled

All built as static libraries into the core (`core/build_media.rs`), from
the tarballs in `core/vendor/` (their sources, hashes and licences are in
[`core/vendor/README.md`](core/vendor/README.md)):

| Library | Version | Why |
| --- | --- | --- |
| mpv (libmpv) | 0.42.0 | The player. |
| FFmpeg | 9.0.2 | Demuxing and decoding. mpv 0.42 needs 6.1 or newer. |
| libplacebo | 7.387.0 | Required by mpv 0.42, which needs 7.387 or newer; Ubuntu 24.04 has 6.338. |
| libass | 0.17.5 | Subtitles; required by mpv. |
| FreeType, HarfBuzz, FriBidi | 2.15.0, 15.1.0, 1.0.18 | Required by libass. |
| zlib | 1.3.2 | mpv's MKV demuxer and FFmpeg (compressed tracks and headers). |
| libdisplay-info | 0.4.0 | Required by mpv's DRM support, which VA-API needs (see below). |
| NVIDIA codec headers | 12.1.14.0 | Headers only, for NVDEC. |
| rav1d's dav1d headers | rav1d 1.1.0 | FFmpeg decodes AV1 through rav1d. |

Versions are the newest stable releases on 2026-11-14, except zlib:
1.4 had been out 9 days and changes its build, so 1.3.2.

## What comes from the system, and why

Only the interfaces to the machine: things that must match the machine's
drivers, servers or configuration, which every Ubuntu and Mint desktop has,
and whose ABIs have been stable for many years.

| Library | Why it can't be bundled |
| --- | --- |
| libc, libm, libpthread, librt, libatomic, libstdc++ | The system's C and C++ runtime. |
| libEGL (glvnd) | Dispatches to the GPU driver's OpenGL. |
| libdrm, libva, libva-drm | The GPU driver's interfaces; libva loads the driver's VA-API module. |
| libpulse, libasound | Talk to the sound server (PulseAudio or PipeWire) and the kernel. |
| fontconfig | Reads the system's font configuration and finds its fonts, for subtitles. |

`build_media.rs` names these (`SYSTEM_PACKAGES`, `SYSTEM_LIBS`), and the
build stops if any bundled library asks for anything else from the
system. So a new release can't quietly start linking a system library.

## Decisions

Each with what it costs and what could go wrong later.

### Link everything statically into the core

The bundled libraries are static archives linked into the core's static
library, and from there into the app. The app's link hides their symbols
(`--exclude-libs`), as it already does for rav1d.

- For: the app is one executable with no private copies of shared
  libraries to find at run time (no rpath, no `LD_LIBRARY_PATH`). It can't
  pick up a different libmpv or FFmpeg by accident, and its FFmpeg can't
  clash with the system's if another library in the process loads that.
  Shared copies would share one symbol namespace with the system's.
- Against: the app is bigger (45 MB, against 27 MB with the system's
  libmpv), and any change to the stack means relinking it, which is how
  it's built anyway. The LGPL parts (FFmpeg, libplacebo, FriBidi) let users
  relink against their own builds. Pixvitta is GPL and its source is
  public, so that is met.
- Later: none expected. Static libmpv is a supported build of mpv.

### Commit the source tarballs

Decided earlier: builds work offline and nothing can change under us.

- Against: `core/vendor/` is 50 MB, about half of it HarfBuzz (20 MB,
  mostly test fonts) and FFmpeg (12 MB). Every upgrade adds the new
  tarball to the history for good.
- Later: if the repository gets too heavy, move `core/vendor/` to Git LFS,
  or have `build.rs` download the tarballs and check their SHA-256. The
  hashes are already in the vendor README.

### Build it in the core's `build.rs`, always

Built by Cargo, like libheif, instead of a separate script, so `cargo test`
and the app's build both get it without an extra step. Each library is
rebuilt only when its source (the tarball's contents), version or options,
or those of one built before it, change. There is no switch back to the system's libmpv: one build, the one
that ships, is the one tested.

- For: one command builds everything; nothing to install into the system.
- Against: a clean build takes about 2.5 minutes on 16 cores (the core
  alone took 1.5). Cargo's `target/` holds it, so `cargo clean` costs a
  full rebuild.
- Against: building needs meson (1.3 or newer), ninja, python3, nasm, make
  and the development packages of the system libraries above, even to
  work on images only. Ubuntu 24.04's meson (1.3.2) is new enough.
- Later: the macOS build needs its own list of system frameworks in the
  same place (step 5).

### Bundle the subtitle text stack too

libass, FreeType, HarfBuzz and FriBidi are bundled; fontconfig is not.

- For: subtitles render the same on every distribution. macOS has none of
  these libraries, so they would have to be built there anyway, and one
  recipe serves both. fontconfig stays the system's because it reads the
  system's configuration and font cache.
- Against: two FreeTypes live in the process: ours, used by libass, and the
  system's, which fontconfig and Qt load. They don't meet. Ours is hidden,
  and libass only takes file paths from fontconfig, never FreeType
  objects. `--exclude-libs` keeps it that way.
- Later: FreeType, HarfBuzz and libass parse fonts embedded in video files,
  which are untrusted input. A distribution would patch its copies for a
  security fix; ours are fixed only when we upgrade. The same holds for
  FFmpeg, the largest attack surface. Watch their security releases.

### Decode AV1 video with rav1d

FFmpeg's libdav1d decoder is built against rav1d's copy of dav1d's headers
and calls rav1d, which exports dav1d's C API. FFmpeg's configure insists on
linking a test program against "dav1d", so it gets a stand-in library with
only `dav1d_version`. The final link takes the real functions from rav1d.

- For: one AV1 decoder for images and video, memory-safe, already built.
  Bundling libdav1d as well wouldn't link at all: it defines the same
  `dav1d_*` names as rav1d.
- Against: rav1d is somewhat slower than dav1d. Hardware decoding covers
  AV1 on recent GPUs. A panic on a rav1d worker thread ends the app, as for
  AV1 images (`future-work.md`).
- Later: rav1d's headers in `core/vendor/rav1d-1.1.0/` must be updated with
  the crate. If rav1d ever drops or changes its C API, the alternative is
  libdav1d for both images and video.

### Hardware decoding: VA-API through the DRM render node, and NVDEC

FFmpeg and mpv are built with VA-API (Intel, AMD, and NVIDIA through
nvidia-vaapi-driver) and NVDEC (NVIDIA's own driver). Nothing is wired
up in the app yet (step 4).

- VA-API reaches the GPU through its render node (`/dev/dri/renderD128`),
  which the app opens and hands to libmpv. That works under X11 and Wayland
  alike, without mpv's X11 or Wayland code. mpv's Wayland support couldn't
  be built anyway: it needs wayland-client 1.23, and Ubuntu 24.04 has 1.22.
  The cost is libdisplay-info, which mpv's DRM support requires.
- Zero-copy VA-API needs the app's OpenGL context to be EGL. Qt uses EGL on
  Wayland, but GLX on X11 unless told otherwise. Under GLX, mpv falls back
  to copying frames back from the GPU (`vaapi-copy`), which is slower but
  works.
- NVDEC loads NVIDIA's driver at run time and links nothing. Its headers
  are 12.1, the oldest FFmpeg 9 accepts, so drivers from 530 on work
  (Ubuntu 24.04's NVIDIA 535 branch included). Newer headers would need
  newer drivers and gain nothing for decoding. On NVIDIA, mpv's CUDA
  interop works with GLX too.
- Not built: Vulkan video, VDPAU (deprecated). Vulkan would need the Vulkan
  loader and mpv's Vulkan output, which the OpenGL render API doesn't use.

### Sound through PulseAudio's API, then ALSA

- For: PipeWire, the default since Ubuntu 22.10 and Mint 21, also serves
  PulseAudio's API, so one output covers both servers. libpulse's ABI has
  been stable for over 15 years. ALSA is the fallback without a sound
  server.
- Against: mpv's native PipeWire output is not built. It has lower latency,
  which a viewer doesn't need, and would be one more library to link.
- Later: if a distribution drops PulseAudio compatibility from PipeWire,
  add `pipewire` to mpv's options and `libpipewire-0.3` to
  `SYSTEM_PACKAGES`.

### What FFmpeg and mpv are built with

FFmpeg starts from `--disable-everything --disable-autodetect`. It then
enables:
- the containers in the plan (MP4/M4V/MOV, WebM/MKV, Ogg, AVI)
- their usual video and audio codecs
- subtitle decoders
- the hardware decoders above
- the few libavfilter filters mpv's bridge needs

mpv starts from `-Dauto_features=disabled` and enables:
- the OpenGL render API
- EGL, DRM, VA-API and CUDA
- PulseAudio and ALSA
- zlib and iconv

Lua scripting (the on-screen controller, youtube-dl) is off; the app draws
its own controls.

- For: nothing is picked up because it happened to be installed on the
  build machine, so two machines build the same thing.
- Against: a format not listed doesn't play. Adding one is a line in
  `FFMPEG_OPTIONS`, and the corpus check catches a missing decoder. It
  fails a sample whose video, or audio track, doesn't decode.
- Later: formats beyond the plan (MPEG-TS, FLV, WMV, raw streams) and
  external subtitle files (`.srt` next to a video) need their demuxers
  added.

### Licences

FFmpeg is built without its GPL parts (LGPL-2.1+). mpv is built with its
default `gpl=true` (GPL-2.0+). Everything bundled can be combined with
Pixvitta's GPL-3.0. Packaging (plan step 6) has to ship the notices of
every bundled library; the list is in the vendor README.

### Which machines it runs on

The app needs the build machine's glibc or newer, and the system libraries
above, at their build-time sonames. Build releases on the oldest system
supported (Ubuntu 24.04), as is usual. The .deb then depends on `libva2`,
`libva-drm2`, `libdrm2`, `libegl1`, `libpulse0`, `libasound2t64` and
`libfontconfig1`, which every Ubuntu and Mint desktop has installed.

## Steps

1. **Done:** build a pinned FFmpeg in the core.
2. **Done:** build libmpv and everything under it, link it into the core,
   and check the corpus through it. The corpus video check now requires a
   decoded video frame, and decoded audio when there is an audio track. An
   AV1 sample was added.
3. **Done:** always use the bundled libmpv. The app and CI no longer use
   the system's libmpv at all.
4. Hardware decoding in the app: open the render node and pass it as
   `MPV_RENDER_PARAM_DRM_DISPLAY_v2`, decide whether Qt should use EGL on
   X11, and check that decoding really happens on the GPU (VA-API on Intel
   or AMD, NVDEC on NVIDIA). Check too which AV1 decoder mpv picks with
   hardware decoding on: hardware AV1 goes through FFmpeg's own `av1`
   decoder, not libdav1d.
5. macOS: the same libraries with VideoToolbox, CoreText for libass instead
   of fontconfig, and CoreAudio. No DRM, VA-API, PulseAudio, ALSA or
   fontconfig.
6. Player parity: seek, time, volume, mute, loop, autoplay, J/K/L and
   "native or smaller" sizing, drawn by the app from state the core
   reports.

## Not yet seen working

- A video played on a screen through the bundled libmpv. The corpus check
  decodes through it, and the app starts with it, but nothing has been
  watched.
- Subtitles through the bundled libass (no sample has subtitles).
- Hardware decoding of any kind (step 4).
