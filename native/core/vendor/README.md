# Vendored libraries

Release tarballs of the C and C++ libraries the core builds into itself,
exactly as published upstream. `build.rs` unpacks them into Cargo's build
directory and builds them as static libraries with CMake: libde265 first,
then libheif against it, with every other codec and helper library off. The
HEIF decoder (`src/heif.rs`) uses them for HEIC and AVIF; AV1 is decoded by
rav1d (a Rust crate), which `src/heif_shim.cc` registers with libheif as a
decoder plugin at run time.

`build_media.rs` also builds libmpv
and everything under it from here, as static libraries, in this order:
zlib, FreeType, FriBidi, HarfBuzz, libass, libdisplay-info, NVIDIA's codec
headers, rav1d's dav1d headers, FFmpeg, libplacebo, mpv. Each is configured
with what it needs switched on by name and everything else off.
[`../../video-plan.md`](../../video-plan.md) says what is bundled, what
isn't, and why.

| File | Source | SHA-256 | Checked against |
| --- | --- | --- | --- |
| `libde265-1.1.3.tar.gz` | https://github.com/strukturag/libde265/releases/download/v1.1.3/libde265-1.1.3.tar.gz | `554228bd17788c99a7e63b37ab5634722190e6e2bf60c1dcb01cef328e133905` | GitHub's asset digest |
| `libheif-1.23.7.tar.gz` | https://github.com/strukturag/libheif/releases/download/v1.23.7/libheif-1.23.7.tar.gz | `f7483e818503ea6224c8863e4a56ac02c7089021a98472c811c12aa19faf2475` | GitHub's asset digest |
| `zlib-1.3.2.tar.xz` | https://github.com/madler/zlib/releases/download/v1.3.2/zlib-1.3.2.tar.xz | `d7a0654783a4da529d1bb793b7ad9c3318020af77667bcae35f95d0e42a792f3` | signature, Mark Adler `5ED4 6A67 21D3 6558 7791 E2AA 783F CD8E 58BC AFBA` |
| `freetype-2.15.0.tar.xz` | https://download.savannah.gnu.org/releases/freetype/freetype-2.15.0.tar.xz | `93cd47eb719c325107f2d3cf087d06299e944c3b48a40b55537302304dea1dd5` | signature, Werner Lemberg `E306 7470 7856 409F F194 8010 BE6C 3AAC 63AD 8E3F` |
| `fribidi-1.0.18.tar.xz` | https://github.com/fribidi/fribidi/releases/download/v1.0.18/fribidi-1.0.18.tar.xz | `1de5e8073d035388b71d0b2d452b1da1f8caeea8a7702997b401fe1b6250727f` | GitHub's asset digest |
| `harfbuzz-15.1.0.tar.xz` | https://github.com/harfbuzz/harfbuzz/releases/download/15.1.0/harfbuzz-15.1.0.tar.xz | `0fc7c565443a5f4be7da65ac5ee5bd737d9b158dc908708b7689a0a5796b0c8d` | GitHub's asset digest |
| `libass-0.17.5.tar.xz` | https://github.com/libass/libass/releases/download/0.17.5/libass-0.17.5.tar.xz | `2dca25c0e0c837ddf00b52011b3f82cac1e4ddd3ad018227806b0c2288864acc` | signature, Oneric `DDAF C19E 46B2 AD2D 6B26 F843 97A0 8E0C FFD7 0951` |
| `libdisplay-info-0.4.0.tar.xz` | https://gitlab.freedesktop.org/emersion/libdisplay-info/-/releases/0.4.0 | `43b180baa143e2035654759d84e2b2f5ee77d5fe817c423838c7fe59c0d68459` | the `.sha256sum` published with it |
| `nv-codec-headers-12.1.14.0.tar.gz` | https://github.com/FFmpeg/nv-codec-headers/releases/download/n12.1.14.0/nv-codec-headers-12.1.14.0.tar.gz | `62b30ab37e4e9be0d0c5b37b8fee4b094e38e570984d56e1135a6b6c2c164c9f` | none published (headers only) |
| `ffmpeg-9.0.2.tar.xz` | https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz | `8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e` | signature, FFmpeg release key `FCF9 86EA 15E6 E293 A564 4F10 B432 2F04 D676 58D8` |
| `libplacebo-7.387.0.tar.xz` | made here from https://code.videolan.org/videolan/libplacebo tag `v7.387.0` (commit `275f7dea27924cdd34ab2e6c20e448b6bc4fab65`); see below | `7cee2b412283e124ec4e8b40beb405a7b76fa862e27d4f6eb4018e3afefcc86d` | the tag's commit |
| `mpv-0.42.0.tar.gz` | https://github.com/mpv-player/mpv/archive/refs/tags/v0.42.0.tar.gz | `bcfebbfa2b65a6d88dc97ea18117831072373e38b5785a2afb874ed4df5070dd` | signature (`mpv-0.42.0.tar.gz.asc` on the release), Kacper Michajłow `D83F 25E4 4BD6 B948 724A B75F 6580 1323 38AB D4E2` |
| `rav1d-1.1.0/` | `include/dav1d/*.h`, `version.h.in` and `COPYING` from https://github.com/memorysafety/rav1d tag `v1.1.0` | (files) | the tag |

Licences, as built: libde265 and libheif LGPL-3.0 (libheif's examples are
MIT; they aren't built); FFmpeg LGPL-2.1 or later (none of its GPL parts
are on; configure prints the licence at the end); mpv GPL-2.0 or later (its
default, `gpl=true`); libplacebo and FriBidi LGPL-2.1 or later; FreeType
under the FreeType License (or GPL-2.0); HarfBuzz MIT; libass ISC; zlib
Zlib; libdisplay-info and the NVIDIA headers MIT; rav1d's headers
BSD-2-Clause. All of them can be combined with Pixvitta's GPL-3.0. A
package has to ship their notices (FreeType's licence asks for a credit
line in the documentation).

### libplacebo's tarball

libplacebo publishes no release tarball, and its git tag needs five of its
submodules to build. The tarball here is the tag's commit and those five
submodules at the commits the tag records, without `.git` or the demos'
submodule. The Vulkan headers are needed though Vulkan is off: libplacebo
always compiles its Vulkan stubs, and without its own copy it takes the
system's headers instead.

```sh
git clone --depth 1 --branch v7.387.0 --recurse-submodules --shallow-submodules \
    https://code.videolan.org/videolan/libplacebo.git libplacebo-7.387.0
cd libplacebo-7.387.0
N=libplacebo-7.387.0
git archive --format=tar --prefix=$N/ HEAD > ../$N.tar
for m in 3rdparty/glad 3rdparty/jinja 3rdparty/markupsafe 3rdparty/fast_float \
         3rdparty/Vulkan-Headers; do
    (cd $m && git archive --format=tar --prefix=$N/$m/ HEAD > ../../../part.tar)
    tar --concatenate -f ../$N.tar ../part.tar && rm ../part.tar
done
xz -9 ../$N.tar
```

The submodule commits were glad `73db193f853e2ee079bf3ca8a64aa2eaf6459043`,
jinja `15206881c006c79667fe5154fe80c01c65410679`, markupsafe
`297fc8e356e6836a62087949245d09a28e9f1b13`, fast_float
`97b54ca9e75f5303507699d27c6b4f4efe4641a1` and Vulkan-Headers
`74d8a6cb930c68ef617b202c3ff3c59d919e086b` (`git submodule status`).

### rav1d's headers

FFmpeg's libdav1d decoder is compiled against these and calls rav1d, which
exports dav1d's C API, so AV1 video and AV1 images share one decoder. They
must match the rav1d version in `Cargo.lock`: update them, and
`DAV1D_API_VERSION` in `build_media.rs` (rav1d's `DAV1D_API_VERSION_*`),
whenever rav1d is upgraded.

## Updating

1. Download the new release tarball from the project's GitHub releases page
   (the `.tar.gz` asset attached to the release, not the "Source code"
   archive GitHub generates).
2. Check its SHA-256 against the digest GitHub shows for the asset
   (`gh api repos/strukturag/libheif/releases/tags/<tag> --jq '.assets[].digest'`).
3. Replace the old tarball here, update `LIBDE265` or `LIBHEIF` in
   `build.rs`, and update the table above.
4. Read the release's changes to `CMakeLists.txt` for new options, which
   may switch on a codec or look for a library on the system; turn them off
   in `build.rs`. A clean build's CMake output lists what libheif found.
5. If libheif's API changed, check `src/heif_shim.cc` still compiles without
   warnings, then run the corpus check. If the decoder plugin API version
   went up, read the new fields in `heif_plugin.h`: the shim fills the
   plugin struct by field name and leaves newer fields zero.

### The video libraries

1. Download the release and check it as the table says: the signature
   (`gpg --verify`, with the key fetched by its fingerprint), the published
   digest, or for libplacebo the tag.
2. Replace the old file here, update the version constant in
   `build_media.rs`, and update the table.
3. Read the release notes for renamed or new build options. A new option
   that is on by default may pick up a library from the machine; turn it off
   in `build_media.rs`. The link step fails if anything outside
   `SYSTEM_PACKAGES` is asked for, which catches most of these.
4. For FFmpeg, read the end of configure's output (`cargo build -vv`),
   which lists every component it enabled and the licence. For mpv, check
   that the release supports the FFmpeg and libplacebo versions here (its
   release notes say which it needs).
5. Run the corpus check.
