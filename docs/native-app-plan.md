# Native App

## Status

The Linux thin slice is being built in `native/` (see `native/README.md`).
The Electron app keeps shipping while this is worked out. `pixvitta-rs` (Rust, Slint, libmpv) was an earlier throwaway
experiment; its libmpv and image decoding code is a starting point, not the
architecture.

## Goal

Replace the Electron app with native apps for macOS and Linux that share one
core.

- **Compatibility is critical.** Pixvitta must read the files it is supposed
  to read. A file that plays slowly still counts; a file that does not play is
  a bug.
- **Performance is important but secondary.**
- **Ownership is the reason to leave Electron.** Electron could be given more
  codecs (see "Rejected options"), but the goal is to own the stack: decoding,
  the media pipeline, and the UI, instead of renting them from Chromium.

## Decisions

- Playback uses **libmpv**. It has the broadest compatibility of any engine.
- The UI is **split per platform**, like VLC (`modules/gui/qt` and
  `modules/gui/macosx`). The split is in the code, not between processes: one
  app, one shared core.
- **macOS UI is native Swift.** AppKit or SwiftUI, whichever fits each piece;
  the choice does not matter much. It uses Liquid Glass.
- **The macOS video surface is an AppKit view with a `CAOpenGLLayer`** that
  libmpv renders into, like IINA. It can sit inside SwiftUI.
- **macOS 27 is the minimum.** Liquid Glass needs no fallback. (Apple said
  macOS 26 is the last release for Intel Macs, so this also means Apple
  Silicon only.)
- macOS and Linux are equally important. A Mac is available for testing.
- **Linux UI is Qt 6 and QML.** Reference: Haruna and KDE's MpvQt wrapper.
  The requirements are that it works, looks good, and performs well; a
  Rust-only Linux app is not a goal. Chosen over GTK4 and libadwaita because:
  - GTK 4 deprecated its X11 backend, with removal planned for GTK 5. Qt
    supports X11 and Wayland. Development happens on X11 with an NVIDIA card,
    where Celluloid has an open startup stall.
  - Qt has a proven AppImage route (mpc-qt ships AppImage with zsync updates).
  - In QML the video is an ordinary element, so UI layers over it easily.
  - QML is declarative with bindings, close to how the React renderer is
    built today.
  - libadwaita looks like GNOME on every desktop.

  Cost: no mature Rust bindings (`cxx-qt` says its API changes frequently), so
  Linux needs a thin C++ layer between QML and the core. It only forwards
  calls and hosts the video item.
- **The core decodes every image itself** with bundled libraries, never the
  platform's decoders, so a file behaves the same on both systems.
  - The core hands the UI plain pixels, already rotated per EXIF. The UI
    uploads them as a texture.
  - Animated images are handed over as frames with their durations.
  - Large images are decoded at screen size first, then at full resolution
    when the user zooms in. Tiling waits until a file in the corpus needs it.
- **Output is sRGB and SDR, permanently.** The core converts every image to
  sRGB. Wide gamut and HDR output are out of scope and will not be added. HDR
  and 10-bit files must still open: they are converted down (libmpv tone maps
  video).
- **View calculations live in the core; interaction stays in the toolkit.**
  This is what keeps two UIs from drifting apart.
  - Core: fit scale, zoom steps, pan limits, item sizes for continuous
    scroll, what "next" means, selection. Pure calculations only; the core
    never drives the drawing loop.
  - Toolkit: gestures, momentum, animation, list recycling. Fighting
    `NSScrollView` or QML's `Flickable` makes an app feel wrong.
- **The C API follows libmpv's two rules.** The rest is shaped by building
  both UIs.
  - The core never calls into the UI from its own threads, except for one
    "wake up" callback. The UI then collects pending events on its main
    thread.
  - The core owns every pixel buffer. The UI hands it back with a release
    call.
- **ExHentai sign-in does not use a bundled browser engine.** The system
  browser cannot hand cookies back to us, so:
  - macOS: `WKWebView`, which is part of the system.
  - Linux: import the cookies from the user's browser, as yt-dlp does with
    `--cookies-from-browser`. Firefox is easy; Chrome encrypts its cookies,
    so it is more fragile. Pasting the cookies by hand is the fallback.
- **Electron is not frozen.** It keeps evolving as the place to try features
  and UI ideas, and it will diverge from the native apps. The finish line for
  the native apps is the Electron feature list as of 2026-11-09, not whatever
  Electron has later.
- **Formats.** Today: JPEG, PNG, GIF, WebP, BMP, AVIF, SVG, ICO; MP4, M4V,
  MOV, WebM, OGV, OGG. Added: MKV, AVI, 10-bit HEVC, ProRes, HEIC, JPEG XL,
  TIFF. Camera RAW and PSD are out of scope.
- **File types are detected by content, not extension**, so mislabelled files
  and files without extensions are not skipped.
- **Patented decoders such as HEVC are bundled**, following normal open-source
  practice (mpv, VLC, IINA).
- **The native code lives in this repo, under `native/`**, next to the
  Electron app: the Rust core in `native/core` and the Linux app in
  `native/linux`. The macOS app joins them later.
- **The Linux app is built first.** macOS follows once the Linux thin slice
  works, so the first version of the core API is shaped by one UI and then
  checked against the second.
- **Core: Rust with a plain C API**, the way libmpv and libVLC expose theirs.
  Swift and C++ both call C directly, so neither UI depends on young binding
  tools.
- **Decoders are bundled and pinned** (libmpv, FFmpeg, libheif, libjxl, ...),
  never taken from the system, so support does not change with the distro or
  OS version. VLC's `contrib/` and Celluloid's Flatpak manifest are examples.
- **Linux ships .deb first.** The focus is Ubuntu and other Debian-based
  systems. The .deb bundles Qt and the decoders privately instead of depending
  on the distro's Qt, whose version varies. AppImage is held back until the
  .deb is solid; Flatpak is optional later.
- **.deb updates come from our own APT repository**, the standard on Debian
  and Ubuntu (Chrome, VS Code, and Signal do this).
  - Installing the .deb registers the repository, so the system's updater
    delivers Pixvitta updates. The app carries no updater code for this.
  - CI builds the signed repository with a tool such as `reprepro` or `aptly`
    and serves it as static files. Nightly and stable are two channels in it.
  - The in-app update button can ask the system to install through
    PackageKit.
  - Accepted costs: updates arrive on the system's schedule unless the user
    presses the button, and we maintain a signing key.
  - The Electron app should be able to update into the native app, as long as
    the native .deb keeps the package name. Not tested.
- **macOS updates use Sparkle**, the standard updater for native Mac apps.
  IINA uses it.
- **A sample-file corpus defines compatibility.** Real files with expected
  results, run against the core. This is a defined spec that will outlive
  implementation changes, so it deserves tests.
  Most testing sits here, in the core. The view calculations are in the core
  too, so zoom, pan, and scroll layout are tested without a UI.

## Open questions

None right now.

## Deferred

Not worth deciding yet.

- Translations: `gt-react` has no native equivalent.
- AppImage updates. Candidates: AppImageUpdate with zsync (mpc-qt ships this
  way; check how well it is maintained), or downloading the new file and
  replacing the old one in place.
- UI testing without Playwright. Candidates: Qt Quick Test on Linux and
  XCUITest on macOS, kept to the few complicated flows.

## Architecture

```
Rust core (C API)
  sources and providers, request broker, cache, downloads, thumbnails,
  image decoding, libmpv control
        |                                  |
macOS UI (Swift)                    Linux UI (Qt 6 / QML + thin C++)
  CAOpenGLLayer video view            QQuickFramebufferObject video item
```

The core owns everything that is not drawing or interaction. The global request broker rules,
including the halt and quit on HTTP 429, move with it unchanged.

Video on both platforms uses libmpv's OpenGL render API inside the toolkit's
own OpenGL surface. There is no bridge between graphics stacks.

## Order

1. Write down the supported formats and collect the sample files.
2. Build the core's C API with folder sources and image decoding.
3. Build a thin version: open a folder, show an image, play a video. Linux
   first, then macOS, so both UIs shape the core API before it grows.
4. Bundle and pin the decoders on both platforms.
5. Port web sources, downloads, and thumbnails.
6. Packaging, signing, and updates.
7. Reach the 2026-11-09 Electron feature list, then replace Electron.

## Risks

- **Two UIs, one maintainer.** Zoom, gestures, continuous scroll, and the
  filmstrip are built twice and can drift apart. Keeping the view
  calculations in the core limits this. Haruna, Celluloid, and mpc-qt show
  one person can sustain a Linux UI; IINA shows the cost of a polished macOS
  one (about 2.3 MB of Swift).
- **libmpv is not the end of compatibility work.** IINA carries hardware
  decoding workarounds; Celluloid has had driver-specific bugs (NVIDIA startup
  stalls, VA-API breaking under one Flatpak runtime).
- **OpenGL on macOS is deprecated.** It still works and IINA still uses it. If
  Apple removes it, mpv has to move too. Not yet checked on macOS 27: build
  mpv's `cocoa-rendergl` example once the Mac is connected. Neither mpv nor
  IINA has reported a break.
- **Packaging pinned decoders** is the largest ongoing cost.
- **No finish line.** A rewrite for ownership can drag on, and Electron keeps
  gaining features. The finish line is therefore fixed at the 2026-11-09
  Electron feature list.
- **Browser cookie import is fragile.** Browsers change how they store and
  encrypt cookies; yt-dlp has to keep up with this.

## Rejected options

- **GPUI.** Discord is rebuilding its client on it, but its Linux renderer is
  wgpu, so libmpv's OpenGL output needs an unproven bridge. A native UI per
  platform avoids that.
- **Slint.** Works with libmpv on Linux in `pixvitta-rs`, but its OpenGL path
  is deprecated on macOS and it is not native on either platform.
- **Electron with a Rust add-on or media server.** Electron 45's experimental
  `sharedTexture` can show libmpv frames in the page (sbtlTV does this on macOS
  and Linux), so Electron can get mpv's codecs. Rejected as a compromise: it
  keeps Chromium, raises memory, and still needs per-platform GPU code.
  `sharedTexture` is stable in shape but young: Electron tests it only on
  Apple Silicon macOS, and Linux results depend on the GPU and driver.
- **One Qt UI on both platforms.** Rejected for macOS in favour of native Swift
  and Liquid Glass.
- **GTK4 and libadwaita on Linux.** Its strongest point is `gtk4-rs`, which
  would make the Linux app Rust only, and that is not a goal. Celluloid stays
  a useful reference for `GtkGLArea` plus libmpv.

## References

- IINA: `iina/ViewLayer.swift` (`CAOpenGLLayer`), `iina/MPVController.swift`
  (hardware decoding workarounds), `iina/TranslucentView.swift`
  (`NSGlassEffectView`). https://github.com/iina/iina
- Celluloid: `src/celluloid-video-area.c` (`GtkGLArea`), `src/celluloid-mpv.c`
  (render context, X11 and Wayland), Flatpak manifest.
  https://github.com/celluloid-player/celluloid
- MpvQt and Haruna: https://github.com/KDE/mpvqt, https://github.com/KDE/haruna
- mpc-qt (Qt, AppImage with zsync): https://github.com/mpc-qt/mpc-qt
- media_kit (libmpv in Flutter, per-platform texture bridges):
  https://github.com/media-kit/media-kit
- mpv examples (`libmpv/qml`, `libmpv/cocoa-rendergl`):
  https://github.com/mpv-player/mpv-examples
- GTK X11 deprecation: https://www.phoronix.com/news/GTK-X11-Now-Deprecated

## Decision log

- 2026-11-05: Discord's GPUI rebuild prompted the discussion. Goal set as
  owning the stack; leaving Electron even if it could play every codec.
- 2026-11-06: Compatibility is critical, performance secondary. Electron with a
  Rust add-on rejected as a compromise. Split per-platform UI chosen; macOS UI
  is native Swift with Liquid Glass. Qt 6 proposed for Linux over GTK4.
- 2026-11-08: macOS 27 minimum. Linux keeps .deb alongside AppImage.
- 2026-11-09: Plan reviewed. Image pipeline decided: the core decodes
  everything and outputs sRGB. Wide gamut and HDR output ruled out for good.
  View calculations go in the core, interaction stays in the toolkit. C API
  follows libmpv's event and buffer rules. ExHentai sign-in uses `WKWebView`
  on macOS and browser cookie import on Linux. The Electron freeze is dropped;
  the finish line is the Electron feature list as of this date.
- 2026-11-09: Qt 6 and QML confirmed for the Linux UI.
- 2026-11-09: Confirmed: Rust core with a C API, bundled and pinned decoders,
  AppImage and .deb with our own updater, and the sample-file corpus.
- 2026-11-09: Camera RAW and PSD ruled out. File types detected by content.
  Patented decoders bundled as other open-source players do. Translations and
  UI testing deferred.
- 2026-11-09: .deb ships first, updated from our own APT repository. AppImage
  held back until the .deb is solid. Sparkle for macOS updates.
- 2026-11-09: The native code lives in this repo under `native/`. The Linux
  app is built first; macOS follows once the Linux thin slice works.
- 2026-11-12: HEIC decodes with libheif and libde265, built from release
  tarballs pinned in the repo. Pure-Rust HEIC decoders were measured against
  72 files; the best (`heifer`) decoded all of them correctly but is five
  weeks old, so it was not adopted.
- 2026-11-12: The folder scan trusts recognised extensions and detects every
  other file by content, because reading every file's header is too slow on
  hard disks and network shares. The decoder always goes by content. TIFF
  and ICO are not detected by content in the scan, because camera RAW shares
  TIFF's signature.
