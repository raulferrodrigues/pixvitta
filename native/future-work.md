# Future work

What is known to be missing or wrong in the native app as built so far. Each
entry records the problem and the proposed direction, so it can be picked up
without repeating the investigation. Steps of
[the plan](../docs/native-app-plan.md#order) that have not been started (the
macOS UI, web sources, downloads, thumbnails, packaging, updates) are not
repeated here.

Remove an entry when it is done.

## Images

### Animated AVIF and HEIF sequences don't play

An animated AVIF or a HEIF image sequence shows its still image, if it has
one. Before AVIF went through libheif it was refused outright.

Proposed direction: read the frames through libheif's sequence (track) API
and hand them to the core's animation API (`pv_animation_*`), as GIF and
WebP are. The rav1d plugin in `core/src/heif_shim.cc` returns one picture
per decoder today and would have to return every frame.

### Animated JPEG XL shows only its first frame

Proposed direction: jxl-oxide gives each frame with its duration and does
the blending; feed them to the animation API.

### HDR and wide-gamut files without an ICC profile have wrong colours

For HEIC and AVIF, libheif applies the matrix and range from the file's
colour information (nclx) and nothing else. Primaries and transfer function
are not converted, so a BT.2020 PQ or HLG picture without an ICC profile
opens with washed-out or dark colours. Files with an ICC profile are
converted to sRGB correctly.

Proposed direction: read the nclx from the image handle, build a moxcms
profile from its code points and convert to sRGB, as the ICC path does. PQ
and HLG also need tone mapping down to SDR; that needs a curve chosen and a
reference to compare against. Output stays sRGB and SDR, as the plan says.

### Limits that come from libheif

- An image whose coded size is larger than the size the file declares for
  it is refused. libheif checks this on purpose. Two test files hit it: a
  damaged one, and a layered AV1 image that shows a smaller layer. libavif
  opens both.
- An image cropped (`clap`) at an odd offset in 4:2:0 or 4:2:2 comes out at
  the right size with wrong colours, up to about 24 levels off. libheif
  loses the colour information while cropping.
- A tiled image with alpha over about 64 megapixels is refused, as is any
  tiled image within about 3% of the 134-megapixel limit. libheif's budget
  against decoding the same tiles repeatedly allows twice the pixel limit
  across a grid and its tiles.
- `with_explicit_unspecified_colour` in `core/src/heif.rs` rewrites a colour
  box that says "unspecified, full range", because libheif reads it as no
  box at all. Windows' AVIF encoder writes such boxes.

None of these has been reported to the libheif project. Proposed direction:
report the first, second and fourth upstream, and look at each again when
libheif is upgraded; the rewrite can go once libheif honours such a box.

### Hostile SVG files can take seconds to minutes to render

Issue #81. They no longer crash the app, but nothing bounds the time.

### A panic on one of rav1d's worker threads still ends the app

A panic in a decoder on the calling thread becomes an error. rav1d decodes
on its own threads, where a panic cannot be caught and would leave the call
waiting forever, so a hook aborts the process instead
(`abort_on_worker_panic` in `core/src/av1.rs`). No file in the test sets or
the corruption runs triggers it.

Proposed direction: look again when rav1d is upgraded; decoding in a
separate process would contain it but is a large change.

### Where AVIF decoding time goes is not measured

A 12-megapixel AVIF takes about 264 ms with rav1d's assembly, down from 377
ms without. The rest is probably libheif's colour conversion, which runs on
one thread, but it was not measured.

### Large images are always decoded in full

The plan decodes a large image at screen size first and at full resolution
when the user zooms in. The C API has no way to ask for a smaller size yet.

## Folder scan

### A file with a media extension of the wrong kind fails to open

The scan trusts a recognised extension without reading the file, so a
`.gif` that is really an MP4 is listed as an image and the decoder refuses
it.

Proposed direction: when an image fails to decode as unsupported, look at
its content again and treat it as a video if it is one. That needs either a
C API call that returns a file's kind by content, or the scan correcting
its entry.

### Some audio files are listed as videos

`.ogg` is trusted as video by extension, as in the Electron app, so an
audio-only `.ogg` is listed and has no picture. An MP4 audio file with a
generic brand (`isom`, `mp42`) and no extension is listed as video too,
because the brands can't tell them apart.

## View

### Only the default fit is in the core

`pv_view_fit` does the Electron app's default, "native or smaller": scaled
down to fit, never up. The Electron app also has a "Fit window" setting
(`mediaScaleMode` in `src/shared/settings.ts`) that scales small images up.

Proposed direction: a mode argument on `pv_view_fit` when settings reach
the native app.

### Zoom, pan and scroll layout are not in the core yet

The plan puts zoom steps, pan limits and the item sizes for continuous
scroll in the core, with tests. Only fitting is there.

## Video

### Hardware decoding is not wired up

The player asks libmpv for `hwdec=auto-safe`, but the Linux app does not
pass its X11 or Wayland display to libmpv's render context, so VA-API
cannot be used and video decodes in software.

Proposed direction: pass the display when creating the render context in
`linux/src/videoitem.cpp`, then check a VA-API decode actually happens.

### libmpv and FFmpeg come from the system

The plan bundles and pins them like the image decoders. The corpus check
uses the machine's libmpv, so a video result can differ between machines.

## Not yet seen working

- AV1 video has not been watched playing on a real screen. The app is
  linked so that rav1d's `dav1d_*` symbols cannot replace the system
  libdav1d that FFmpeg uses, and that was checked with the dynamic linker's
  debug output, not by eye.
- No HEIC file has been opened in the running Linux app. The decode is
  covered by the corpus through the same C API call.
- The core's link line for the C++ standard library on macOS (`c++`) is
  written and has never been built.
