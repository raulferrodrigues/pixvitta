//! Builds libde265 and libheif from the release tarballs in `vendor/` as
//! static libraries, and the small C++ shim (`src/heif_shim.cc`) the HEIF
//! decoder calls them through. Nothing comes from the system but the C and
//! C++ compilers, CMake and the C++ standard library: libheif gets every
//! optional codec and helper library switched off, and is pointed at the
//! libde265 built here, so it can't pick up a copy installed on the machine.
//! Its AV1 decoder is rav1d, which the shim registers at run time.
//!
//! It also builds libmpv, FFmpeg and the libraries under them
//! (`build_media.rs`) and links the core against them, so the app never
//! uses the system's libmpv or FFmpeg.

#[path = "build_media.rs"]
mod media;

use sha2::{Digest, Sha256};
use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::Command;

const LIBDE265: &str = "libde265-1.1.3";
const LIBHEIF: &str = "libheif-1.23.7";

fn main() {
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let vendor = Path::new(env!("CARGO_MANIFEST_DIR")).join("vendor");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/heif_shim.cc");

    let sources = out.join("src");
    let de265_source = extract(&vendor, &sources, LIBDE265);
    let heif_source = extract(&vendor, &sources, LIBHEIF);

    let de265 = cmake::Config::new(de265_source)
        .out_dir(out.join("de265"))
        .profile("Release")
        .define("BUILD_SHARED_LIBS", "OFF")
        // ENABLE_DECODER is the dec265 tool; the library always decodes.
        .define("ENABLE_DECODER", "OFF")
        .define("ENABLE_ENCODER", "OFF")
        .define("ENABLE_SDL", "OFF")
        .define("ENABLE_SHERLOCK265", "OFF")
        .define("ENABLE_INTERNAL_DEVELOPMENT_TOOLS", "OFF")
        .define("WITH_FUZZERS", "OFF")
        // It would print an error line for every damaged file.
        .define("DE265_LOG_LEVEL", "none")
        .build();
    let de265_lib = library_dir(&de265);

    let heif = cmake::Config::new(heif_source)
        .out_dir(out.join("heif"))
        .profile("Release")
        .define("BUILD_SHARED_LIBS", "OFF")
        .define("ENABLE_PLUGIN_LOADING", "OFF")
        .define("ENABLE_MULTITHREADING_SUPPORT", "ON")
        .define("ENABLE_PARALLEL_TILE_DECODING", "ON")
        .define("WITH_LIBDE265", "ON")
        .define("WITH_LIBDE265_PLUGIN", "OFF")
        // Set instead of searched for, so only the libde265 above is used.
        .define("LIBDE265_INCLUDE_DIR", de265.join("include"))
        .define("LIBDE265_LIBRARY", de265_lib.join("libde265.a"))
        // FindLIBDE265 and the other find modules ask pkg-config first.
        .define("CMAKE_DISABLE_FIND_PACKAGE_PkgConfig", "ON")
        .define("WITH_X265", "OFF")
        .define("WITH_KVAZAAR", "OFF")
        .define("WITH_UVG266", "OFF")
        .define("WITH_VVDEC", "OFF")
        .define("WITH_VVENC", "OFF")
        .define("WITH_X264", "OFF")
        .define("WITH_OpenH264_DECODER", "OFF")
        .define("WITH_DAV1D", "OFF")
        .define("WITH_AOM_DECODER", "OFF")
        .define("WITH_AOM_ENCODER", "OFF")
        .define("WITH_SvtEnc", "OFF")
        .define("WITH_RAV1E", "OFF")
        .define("WITH_JPEG_DECODER", "OFF")
        .define("WITH_JPEG_ENCODER", "OFF")
        .define("WITH_OpenJPEG_DECODER", "OFF")
        .define("WITH_OpenJPEG_ENCODER", "OFF")
        .define("WITH_OPENJPH_ENCODER", "OFF")
        .define("WITH_FFMPEG_DECODER", "OFF")
        .define("WITH_UNCOMPRESSED_CODEC", "OFF")
        .define("WITH_WEBCODECS", "OFF")
        .define("WITH_HEADER_COMPRESSION", "OFF")
        .define("WITH_LIBSHARPYUV", "OFF")
        .define("WITH_GDK_PIXBUF", "OFF")
        .define("WITH_EXAMPLES", "OFF")
        .define("WITH_EXAMPLE_HEIF_THUMB", "OFF")
        .define("WITH_EXAMPLE_HEIF_VIEW", "OFF")
        .define("BUILD_TESTING", "OFF")
        .define("BUILD_DOCUMENTATION", "OFF")
        .define("WITH_FUZZERS", "OFF")
        .build();
    let heif_lib = library_dir(&heif);

    cc::Build::new()
        .cpp(true)
        .cpp_link_stdlib(None)
        .std("c++17")
        .file("src/heif_shim.cc")
        .include(heif.join("include"))
        .compile("pixvitta_heif_shim");

    let system = media::build(&vendor, &sources, &out).link();
    // The core's static library can't carry its dynamic links, so the
    // program that links it reads them from here, one per line
    // (linux/CMakeLists.txt passes this variable).
    println!("cargo:rerun-if-env-changed=PIXVITTA_CORE_SYSTEM_LIBS");
    if let Some(file) = std::env::var_os("PIXVITTA_CORE_SYSTEM_LIBS") {
        let flags: String = system.iter().map(|name| format!("-l{name}\n")).collect();
        std::fs::write(file, flags).unwrap();
    }
    // Keep the bundled libraries' symbols out of the dynamic symbol table
    // of the core's own tests, so a system library loaded with them still
    // binds to its own dependencies (fontconfig to the system's FreeType,
    // for one). The app does the same in CMake.
    println!("cargo:rustc-link-arg-tests=-Wl,--exclude-libs,ALL");

    // Order matters for the static link: the shim calls libheif, which calls
    // libde265, and all three need the C++ standard library. The shim also
    // calls av1.rs, which is in the core itself. A program that
    // links the core's static library has to link that last one itself.
    println!("cargo:rustc-link-search=native={}", heif_lib.display());
    println!("cargo:rustc-link-search=native={}", de265_lib.display());
    println!("cargo:rustc-link-lib=static=heif");
    println!("cargo:rustc-link-lib=static=de265");
    let apple = std::env::var("CARGO_CFG_TARGET_VENDOR").as_deref() == Ok("apple");
    println!("cargo:rustc-link-lib={}", if apple { "c++" } else { "stdc++" });
}

fn run(command: &mut Command, what: &str) {
    let status = command
        .status()
        .unwrap_or_else(|error| panic!("{what}: could not run {:?}: {error}", command.get_program()));
    if !status.success() {
        panic!("{what} failed ({status}); its output is above");
    }
}

/// Unpacks `vendor/<name>.tar.gz` or `vendor/<name>.tar.xz` under `into`
/// and returns the source directory (the tarballs hold a single `<name>/`
/// directory).
fn extract(vendor: &Path, into: &Path, name: &str) -> PathBuf {
    let tarball = tarball(vendor, name);
    println!("cargo:rerun-if-changed={}", tarball.display());
    unpack(&tarball, into, name, &digest(&tarball))
}

/// `vendor/<name>.tar.gz`, or else `vendor/<name>.tar.xz`.
fn tarball(vendor: &Path, name: &str) -> PathBuf {
    let gz = vendor.join(format!("{name}.tar.gz"));
    if gz.exists() {
        gz
    } else {
        vendor.join(format!("{name}.tar.xz"))
    }
}

/// Unpacks `tarball`, whose contents hash to `digest`, under `into`, unless
/// the same contents were unpacked there before, and returns `into/<name>`.
fn unpack(tarball: &Path, into: &Path, name: &str, digest: &str) -> PathBuf {
    let source = into.join(name);
    let done = into.join(format!("{name}.extracted"));
    if std::fs::read_to_string(&done).ok().as_deref() != Some(digest) {
        let _ = std::fs::remove_file(&done);
        let _ = std::fs::remove_dir_all(&source);
        let file = File::open(tarball).unwrap_or_else(|error| panic!("{}: {error}", tarball.display()));
        let unpacked = if tarball.extension().is_some_and(|extension| extension == "xz") {
            tar::Archive::new(liblzma::read::XzDecoder::new(file)).unpack(into)
        } else {
            tar::Archive::new(flate2::read::GzDecoder::new(file)).unpack(into)
        };
        unpacked.unwrap_or_else(|error| panic!("unpacking {}: {error}", tarball.display()));
        std::fs::write(&done, digest).unwrap();
    }
    source
}

/// The SHA-256 of a file's contents (the hash the vendor README lists), or
/// of a directory's files, their paths included. Contents only, never
/// modification times, which a fresh checkout resets.
fn digest(path: &Path) -> String {
    let mut hasher = Sha256::new();
    if path.is_dir() {
        let mut files = Vec::new();
        list_files(path, &mut files);
        files.sort();
        for file in files {
            let relative = file.strip_prefix(path).unwrap().to_string_lossy().into_owned();
            let contents = std::fs::read(&file).unwrap();
            hasher.update(format!("{relative}\0{}\0", contents.len()));
            hasher.update(contents);
        }
    } else {
        let mut file = File::open(path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        std::io::copy(&mut file, &mut hasher).unwrap();
    }
    hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

fn list_files(dir: &Path, files: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            list_files(&path, files);
        } else {
            files.push(path);
        }
    }
}

/// Where CMake installed the static library: `lib`, or `lib64` on
/// distributions whose GNUInstallDirs say so.
fn library_dir(prefix: &Path) -> PathBuf {
    let lib64 = prefix.join("lib64");
    if lib64.exists() {
        lib64
    } else {
        prefix.join("lib")
    }
}
