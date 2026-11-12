# Vendored libraries

Release tarballs of the C and C++ libraries the core builds into itself,
exactly as published upstream. `build.rs` unpacks them into Cargo's build
directory and builds them as static libraries with CMake: libde265 first,
then libheif against it, with every other codec and helper library off. The
HEIC decoder (`src/heic.rs`) uses them.

| File | Source | SHA-256 |
| --- | --- | --- |
| `libde265-1.1.3.tar.gz` | https://github.com/strukturag/libde265/releases/download/v1.1.3/libde265-1.1.3.tar.gz | `554228bd17788c99a7e63b37ab5634722190e6e2bf60c1dcb01cef328e133905` |
| `libheif-1.23.7.tar.gz` | https://github.com/strukturag/libheif/releases/download/v1.23.7/libheif-1.23.7.tar.gz | `f7483e818503ea6224c8863e4a56ac02c7089021a98472c811c12aa19faf2475` |

Both are LGPL-3.0 (libheif's examples are MIT; they aren't built).

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
5. If libheif's API changed, check `src/heic_shim.cc` still compiles without
   warnings, then run the corpus check.
