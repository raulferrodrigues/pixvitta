# Pixvitta native

The native rewrite described in [`docs/native-app-plan.md`](../docs/native-app-plan.md).
For now it is a thin slice: open a folder, show its images fitted to the
window (scaled down, never up; animated GIF and WebP play), step through
them, and play videos through libmpv. What is known to be missing or wrong
is listed in [`future-work.md`](future-work.md).

- `core/`: the Rust core, built as a static library with a plain C API
  ([`core/include/pixvitta.h`](core/include/pixvitta.h)). It lists folders,
  decodes images to sRGB RGBA, owns the libmpv player, and does the
  view calculations both UIs share (for now, where an image is drawn to fit
  the view: scaled down, never up, and centred). A folder lists a
  file with an image or video extension as that kind without opening it, and
  reads the first bytes of every other file to tell whether it is an image or
  a video; TIFF and ICO are only listed by extension. The decoder always goes
  by content, so a mislabelled file still opens. It decodes JPEG,
  PNG, GIF, WebP, BMP, TIFF, ICO, HEIC and AVIF (the primary image, grids
  included, through libheif, built from the release tarballs in
  [`core/vendor/`](core/vendor); HEVC decodes with libde265, AV1 with rav1d
  and its assembly), JPEG XL (through jxl-oxide; the first frame
  of an animation) and SVG and SVGZ (through resvg, at the size the file
  declares; only `data:` images, nothing outside the file). An animated
  AVIF or HEIF sequence shows its still image, if it has one. Not yet:
  playing animated AVIF, HEIF sequences and animated JPEG XL. Known limits,
  both libheif's: an image whose coded size is larger than the size the
  file declares for it (a damaged file, or a layered AV1 image showing a
  smaller layer) is refused; and an image cropped (`clap`) at an odd offset
  in 4:2:0 or 4:2:2 shows wrong colours.
- `linux/`: the Linux app, Qt 6 and QML with a thin C++ layer over the C API.
  Video is drawn by libmpv into a `QQuickFramebufferObject`.

## Linux

Needs Rust (through rustup), CMake, a C and C++17 compiler, nasm (on
x86-64), and the system's Qt 6 and libmpv. The core needs CMake, nasm and the
compilers too, even built on its own (the corpus check, for one): its build
script builds libheif and libde265 from source, rav1d assembles its x86-64
assembly with nasm, and the result links the C++ standard library. On Ubuntu 24.04
or Linux Mint 22:

```sh
sudo apt install cmake g++ nasm pkg-config qt6-base-dev qt6-declarative-dev libmpv-dev \
    qml6-module-qtquick qml6-module-qtqml qml6-module-qtqml-models qml6-module-qtqml-workerscript
```

Build from the repository root. CMake runs cargo for the core.

```sh
cmake -S native/linux -B native/linux/build -DCMAKE_BUILD_TYPE=Release
cmake --build native/linux/build -j
```

No other flags are needed, even with Homebrew ahead of the system on `PATH`:

- CMake uses the system's `pkg-config` (`/usr/bin`), the only one that sees
  the system's libmpv, even when another `pkg-config` comes first on `PATH`.
- It looks for `cargo` on `PATH`, then in `~/.cargo/bin`, then asks
  `rustup which cargo`, which covers a rustup installed by Homebrew.
- It ignores Homebrew's prefix when looking for libraries, so the app links
  the system's copies even where Homebrew has the same package.

To use a different tool, pass `-DCARGO=/path/to/cargo` or
`-DPKG_CONFIG_EXECUTABLE=/path/to/pkg-config` (or set `PKG_CONFIG`) to the
first command. These are cached, so remove the build directory to undo them.
To use a library from Homebrew, pass `-DCMAKE_PREFIX_PATH=<homebrew>/opt/<formula>`.

Run it on a folder:

```sh
native/linux/build/pixvitta path/to/folder
```

Left and Right step through the files, and Space plays or pauses a video.

## Corpus

[`corpus/`](corpus) holds the sample files the core must open, and
[`corpus/corpus.toml`](corpus/corpus.toml) says what each must produce. Run
the check, with the core's unit tests, from the repository root:

```sh
cargo test --release --manifest-path native/core/Cargo.toml
```

For each sample it checks that the file opens, that its size is right, and
for images that the pixels roughly match a reference. Images are also
played through the animation API: each frame's duration (and pixels, where
there is a reference per frame), and that the first frame follows the last. Videos go through the
machine's libmpv (size and duration only). Formats the core can't decode yet
are listed with `expected_failure`. The run fails if a sample that should
pass doesn't, or if an expected failure starts passing (then remove the
line). It also lists `corpus/samples/scan/`, a folder of mislabelled files,
and checks which are listed and as what. To add a sample, put the file in
`corpus/samples/<format>/` and add a `[[sample]]` entry;
[`corpus/README.md`](corpus/README.md) has the details and how the existing
files were made.
