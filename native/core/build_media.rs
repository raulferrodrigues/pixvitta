//! Builds libmpv and the libraries it needs from the tarballs in `vendor/`,
//! as static libraries, and links them into the core. What is bundled, what
//! still comes from the system, and why, is in `native/video-plan.md`.
//!
//! Every library is configured with the features it needs switched on by
//! name and everything else off, so nothing found on the machine is picked
//! up by accident. The only libraries taken from the system are the ones
//! that talk to it: OpenGL/EGL, libdrm and libva (the GPU driver), PulseAudio
//! and ALSA (the sound server), fontconfig (the system's fonts) and libc.
//!
//! Each library is rebuilt only when its version or options, or those of a
//! library built before it, change. They add about a minute to a clean
//! build on 16 cores.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

const ZLIB: &str = "zlib-1.3.2";
const FREETYPE: &str = "freetype-2.15.0";
const FRIBIDI: &str = "fribidi-1.0.18";
const HARFBUZZ: &str = "harfbuzz-15.1.0";
const LIBASS: &str = "libass-0.17.5";
const LIBDISPLAY_INFO: &str = "libdisplay-info-0.4.0";
const NV_CODEC_HEADERS: &str = "nv-codec-headers-12.1.14.0";
const FFMPEG: &str = "ffmpeg-9.0.2";
const LIBPLACEBO: &str = "libplacebo-7.387.0";
const MPV: &str = "mpv-0.42.0";
/// The dav1d headers from the rav1d release in Cargo.lock, and the dav1d API
/// version that release implements (`DAV1D_API_VERSION_*` in its lib.rs).
const RAV1D: &str = "rav1d-1.1.0";
const DAV1D_API_VERSION: (u32, u32, u32) = (7, 0, 0);

/// The name of the stand-in library FFmpeg's configure links its dav1d test
/// against. It is never linked into anything: the real dav1d functions are
/// rav1d's, in the core itself.
const DAV1D_STUB: &str = "pixvitta_dav1d_configure_stub";

const FREETYPE_OPTIONS: &[&str] = &[
    "-Dbrotli=disabled",
    "-Dbzip2=disabled",
    "-Dharfbuzz=disabled",
    "-Dpng=disabled",
    "-Dzlib=disabled",
    "-Dhvf=disabled",
    "-Dtests=disabled",
];

const FRIBIDI_OPTIONS: &[&str] = &["-Ddocs=false", "-Dbin=false", "-Dtests=false"];

const HARFBUZZ_OPTIONS: &[&str] = &[
    "-Dfreetype=enabled",
    "-Dglib=disabled",
    "-Dgobject=disabled",
    "-Dcairo=disabled",
    "-Dchafa=disabled",
    "-Dpng=disabled",
    "-Dzlib=disabled",
    "-Dicu=disabled",
    "-Draster=disabled",
    "-Dvector=disabled",
    "-Dgpu=disabled",
    "-Dsubset=disabled",
    "-Dtests=disabled",
    "-Dintrospection=disabled",
    "-Ddocs=disabled",
    "-Dutilities=disabled",
    "-Dbenchmark=disabled",
];

const LIBASS_OPTIONS: &[&str] = &[
    // The system's fonts, through the system's fontconfig.
    "-Dfontconfig=enabled",
    "-Dasm=enabled",
    "-Dlibunibreak=disabled",
    "-Ddirectwrite=disabled",
    "-Dcoretext=disabled",
    "-Dtest=disabled",
    "-Dcompare=disabled",
    "-Dprofile=disabled",
    "-Dfuzz=disabled",
    "-Dcheckasm=disabled",
];

const LIBPLACEBO_OPTIONS: &[&str] = &[
    "-Dopengl=enabled",
    // mpv hands libplacebo the app's OpenGL functions.
    "-Dgl-proc-addr=disabled",
    "-Dvulkan=disabled",
    "-Dvk-proc-addr=disabled",
    "-Dd3d11=disabled",
    "-Dglslang=disabled",
    "-Dshaderc=disabled",
    "-Dlcms=disabled",
    // Dolby Vision metadata, which FFmpeg parses; libdovi isn't needed.
    "-Ddovi=enabled",
    "-Dlibdovi=disabled",
    "-Dunwind=disabled",
    "-Dxxhash=disabled",
    "-Ddemos=false",
    "-Dtests=false",
    "-Dbench=false",
    "-Dfuzz=false",
];

/// Everything off, then the containers and codecs of the formats the app
/// plays (`docs/native-app-plan.md`), their subtitles, and hardware decoding
/// through VA-API and NVDEC. configure adds what a decoder depends on (the
/// VP9 decoder's bitstream filter, the VP3 decoder behind Theora), but not
/// parsers, which are listed here. `--disable-autodetect` keeps it from
/// linking anything else it finds on the machine.
const FFMPEG_OPTIONS: &[&str] = &[
    "--enable-static",
    "--disable-shared",
    "--enable-pic",
    "--disable-programs",
    "--disable-doc",
    "--disable-debug",
    "--disable-network",
    "--disable-autodetect",
    "--disable-avdevice",
    "--disable-everything",
    "--enable-protocol=file",
    // MP4, M4V and MOV; WebM and MKV; OGV and OGG; AVI.
    "--enable-demuxer=mov,matroska,ogg,avi",
    "--enable-decoder=h264,hevc,prores,vp8,vp9,av1,libdav1d,theora,mpeg4,mpeg1video,mpeg2video,mjpeg",
    "--enable-decoder=msmpeg4v1,msmpeg4v2,msmpeg4v3,h263",
    "--enable-decoder=aac,mp3float,mp3,opus,vorbis,flac,ac3,eac3,alac",
    "--enable-decoder=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_u8,pcm_s16be,pcm_s24be",
    "--enable-decoder=ass,ssa,subrip,srt,webvtt,mov_text,text,dvdsub,dvbsub,pgssub",
    "--enable-parser=h264,hevc,vp8,vp9,av1,mpeg4video,mpegvideo,mpegaudio,aac,ac3,opus,vorbis,flac,mjpeg",
    "--enable-parser=dvdsub,dvbsub",
    // What mpv's bridge to libavfilter needs to exist; mpv adds no filters
    // of its own unless asked to.
    "--enable-filter=buffer,buffersink,abuffer,abuffersink,format,aformat,null,anull",
    // Subtitle and header compression in MKV and MP4.
    "--enable-zlib",
    // AV1 in software through rav1d's dav1d API.
    "--enable-libdav1d",
    // Hardware decoding. VA-API (Intel, AMD, and NVIDIA through
    // nvidia-vaapi-driver) goes through the system's libva; NVDEC loads
    // NVIDIA's driver at run time, so it adds nothing to link.
    "--enable-vaapi",
    "--enable-libdrm",
    "--enable-ffnvcodec",
    "--enable-cuda",
    "--enable-nvdec",
    "--enable-hwaccel=h264_vaapi,hevc_vaapi,vp8_vaapi,vp9_vaapi,av1_vaapi,mpeg2_vaapi,mpeg4_vaapi",
    "--enable-hwaccel=h264_nvdec,hevc_nvdec,vp8_nvdec,vp9_nvdec,av1_nvdec,mpeg1_nvdec,mpeg2_nvdec,mpeg4_nvdec",
];

const MPV_OPTIONS: &[&str] = &[
    "-Dlibmpv=true",
    "-Dcplayer=false",
    "-Dtests=false",
    "-Dfuzzers=false",
    "-Dbuild-date=false",
    // Every optional feature off; the ones below on by name.
    "-Dauto_features=disabled",
    // Drawing into the app's OpenGL context through the render API.
    "-Dgl=enabled",
    "-Dplain-gl=enabled",
    "-Degl=enabled",
    // VA-API through the GPU's render node, which the app passes in; this
    // works under X11 and Wayland alike. The drm feature is what enables
    // it, and brings libdisplay-info.
    "-Ddrm=enabled",
    "-Dvaapi=enabled",
    "-Dvaapi-drm=enabled",
    "-Dcuda-hwaccel=enabled",
    "-Dcuda-interop=enabled",
    // Sound: PulseAudio's API, which PipeWire also serves, then ALSA.
    "-Dpulse=enabled",
    "-Dalsa=enabled",
    "-Dzlib=enabled",
    "-Diconv=enabled",
    // Not a feature, so auto_features doesn't cover it: scripts (the
    // on-screen controller, youtube-dl) aren't used.
    "-Dlua=disabled",
];

/// The system libraries the bundle may link, by pkg-config name: the
/// interfaces to the machine (see the module comment). The link fails on
/// anything else, so nothing else from the system creeps in.
const SYSTEM_PACKAGES: &[&str] = &["egl", "libdrm", "libva", "libva-drm", "libpulse", "alsa", "fontconfig"];

/// libc and the compiler's runtime, which the bundled libraries name
/// directly with -l.
const SYSTEM_LIBS: &[&str] = &["m", "dl", "pthread", "rt", "atomic", "stdc++"];

/// Packages a bundled library's pkg-config file asks for that aren't linked,
/// and why.
const UNUSED_PACKAGES: &[(&str, &str)] = &[(
    "vulkan",
    "libplacebo always looks for the Vulkan loader for its headers, though it is built without Vulkan",
)];

pub struct Media {
    prefix: PathBuf,
    pkg_config: PathBuf,
}

/// Builds everything under `out/media` and returns where it is.
pub fn build(vendor: &Path, sources: &Path, out: &Path) -> Media {
    let prefix = out.join("media");
    let mut build = Build::new(vendor, sources, out, &prefix);

    build.step(ZLIB, &[], |build, source, dir| {
        // zlib's own configure, which builds out of tree.
        let mut configure = build.command(source.join("configure"));
        configure
            .arg("--static")
            .arg(format!("--prefix={}", build.prefix.display()))
            .env("CFLAGS", "-O2 -fPIC")
            .current_dir(dir);
        build.run(&mut configure, "zlib's configure");
        build.make(dir, &["install"]);
    });
    build.meson(FREETYPE, FREETYPE_OPTIONS);
    build.meson(FRIBIDI, FRIBIDI_OPTIONS);
    build.meson(HARFBUZZ, HARFBUZZ_OPTIONS);
    build.meson(LIBASS, LIBASS_OPTIONS);
    build.meson(LIBDISPLAY_INFO, &[]);
    build.step(NV_CODEC_HEADERS, &[], |build, source, _| {
        let prefix = format!("PREFIX={}", build.prefix.display());
        build.make(source, &[prefix.as_str(), "install"]);
    });
    build.step(RAV1D, &[], |build, _, dir| install_dav1d_api(build, dir));
    build.step(FFMPEG, FFMPEG_OPTIONS, |build, source, dir| {
        let mut configure = build.command(source.join("configure"));
        configure
            .args(FFMPEG_OPTIONS)
            .arg(format!("--prefix={}", build.prefix.display()))
            .arg(format!("--cc={}", build.cc.display()))
            .arg(format!("--pkg-config={}", build.pkg_config.display()))
            .arg("--pkg-config-flags=--static")
            .arg(format!("--extra-cflags=-I{}", build.prefix.join("include").display()))
            .arg(format!("--extra-ldflags=-L{}", build.prefix.join("lib").display()))
            .current_dir(dir);
        build.run(&mut configure, "FFmpeg's configure");
        build.make(dir, &["install"]);
    });
    build.meson(LIBPLACEBO, LIBPLACEBO_OPTIONS);
    build.meson(MPV, MPV_OPTIONS);
    // If the built libraries go missing (a cleaned build directory), cargo
    // runs this again instead of linking against what isn't there.
    println!("cargo:rerun-if-changed={}", prefix.join("lib/libmpv.a").display());

    Media {
        pkg_config: build.pkg_config.clone(),
        prefix,
    }
}

impl Media {
    /// Tells cargo to link libmpv and everything under it: the bundled
    /// libraries statically, each before the ones it needs, and the system
    /// libraries in SYSTEM_PACKAGES and SYSTEM_LIBS dynamically. Returns the
    /// system libraries, which a program linking the core's static library
    /// has to link itself.
    ///
    /// This walks the bundled pkg-config files itself, rather than asking
    /// for `pkg-config --static --libs mpv`, which would also list the
    /// system libraries' own private dependencies (PulseAudio's internal
    /// library, which isn't on the linker's path, for one).
    pub fn link(&self) -> Vec<String> {
        let pkgconfig = self.prefix.join("lib/pkgconfig");
        // FFmpeg names the system libraries it uses with -l instead of
        // requiring their packages, so those names are allowed too.
        let mut allowed: Vec<String> = SYSTEM_LIBS.iter().map(|name| name.to_string()).collect();
        for package in SYSTEM_PACKAGES {
            let output = Command::new(&self.pkg_config)
                .args(["--libs-only-l", package])
                .output()
                .expect("running pkg-config");
            for flag in String::from_utf8_lossy(&output.stdout).split_whitespace() {
                allowed.extend(flag.strip_prefix("-l").map(str::to_string));
            }
        }
        let mut walk = Walk {
            allowed,
            ..Walk::default()
        };
        walk.visit("mpv", &pkgconfig);
        walk.order.reverse();

        println!("cargo:rustc-link-search=native={}", self.prefix.join("lib").display());
        for name in &walk.order {
            println!("cargo:rustc-link-lib=static={name}");
        }

        let mut system: Vec<String> = Vec::new();
        if !walk.packages.is_empty() {
            let output = Command::new(&self.pkg_config)
                .arg("--libs")
                .args(&walk.packages)
                .output()
                .expect("running pkg-config");
            assert!(
                output.status.success(),
                "pkg-config can't find the system's {}: {}",
                walk.packages.join(", "),
                String::from_utf8_lossy(&output.stderr)
            );
            for flag in String::from_utf8(output.stdout).unwrap().split_whitespace() {
                match flag.strip_prefix("-l") {
                    Some(name) => walk.libs.push(name.to_string()),
                    None if flag == "-pthread" => walk.libs.push("pthread".into()),
                    None if flag.starts_with("-L") => println!("cargo:rustc-link-search=native={}", &flag[2..]),
                    None => panic!("unexpected flag {flag} in the system libraries' pkg-config flags"),
                }
            }
        }
        let lib = self.prefix.join("lib");
        for name in walk.libs {
            // fontconfig's flags name FreeType, which the system's fontconfig
            // loads for itself; the bundle's own copy serves libass.
            if lib.join(format!("lib{name}.a")).exists() {
                continue;
            }
            if !system.contains(&name) {
                println!("cargo:rustc-link-lib=dylib={name}");
                system.push(name);
            }
        }
        system
    }
}

/// A walk over the bundled pkg-config files, from mpv down.
#[derive(Default)]
struct Walk {
    seen: Vec<String>,
    /// Bundled static libraries, each after the ones it needs (reversed at
    /// the end).
    order: Vec<String>,
    /// System packages, from SYSTEM_PACKAGES.
    packages: Vec<String>,
    /// System libraries named with -l.
    libs: Vec<String>,
    /// The -l names allowed from the system: SYSTEM_LIBS and the libraries
    /// of SYSTEM_PACKAGES.
    allowed: Vec<String>,
}

impl Walk {
    fn visit(&mut self, package: &str, pkgconfig: &Path) {
        if self.seen.iter().any(|seen| seen == package) {
            return;
        }
        self.seen.push(package.to_string());
        let file = pkgconfig.join(format!("{package}.pc"));
        let Ok(text) = std::fs::read_to_string(&file) else {
            if SYSTEM_PACKAGES.contains(&package) {
                self.packages.push(package.to_string());
            } else if UNUSED_PACKAGES.iter().any(|(name, _)| *name == package) {
                // Not linked; UNUSED_PACKAGES says why.
            } else {
                panic!(
                    "the bundle needs {package} from the system; bundle it, or add it to SYSTEM_PACKAGES \
                     in build_media.rs if it is an interface to the machine"
                );
            }
            return;
        };
        let field = |name: &str| -> String {
            text.lines()
                .filter_map(|line| line.strip_prefix(name))
                .collect::<Vec<_>>()
                .join(" ")
        };
        let mut own = Vec::new();
        for flag in format!("{} {}", field("Libs:"), field("Libs.private:")).split_whitespace() {
            let name = match flag.strip_prefix("-l") {
                Some(name) => name,
                None if flag == "-pthread" => "pthread",
                None if flag.starts_with("-L") => continue,
                None => panic!("unexpected flag {flag} in {}", file.display()),
            };
            if name == DAV1D_STUB {
                continue;
            }
            if pkgconfig.join(format!("../lib{name}.a")).exists() {
                own.push(name.to_string());
            } else if self.allowed.iter().any(|allowed| allowed == name) {
                if !self.libs.iter().any(|known| known == name) {
                    self.libs.push(name.to_string());
                }
            } else {
                panic!(
                    "{} links -l{name}, which is neither bundled nor from SYSTEM_PACKAGES or SYSTEM_LIBS",
                    file.display()
                );
            }
        }
        // Requires lists names with version constraints: "libass >= 0.12.2,
        // zlib". Only the names matter here.
        let requires = format!("{} {}", field("Requires:"), field("Requires.private:"));
        let mut tokens = requires.split([' ', ',']).filter(|token| !token.is_empty()).peekable();
        while let Some(token) = tokens.next() {
            if matches!(token, ">=" | "<=" | "=" | ">" | "<" | "!=") {
                tokens.next();
                continue;
            }
            self.visit(token, pkgconfig);
        }
        // Post-order: a package's libraries go after those of what it
        // requires, and the reversal puts them before.
        for name in own.into_iter().rev() {
            if !self.order.contains(&name) {
                self.order.push(name);
            }
        }
    }
}

/// The dav1d API FFmpeg's libdav1d decoder is built against: rav1d's copy
/// of dav1d's headers, a pkg-config file, and a stand-in library with
/// `dav1d_version` alone, because configure links a test program against
/// whatever the pkg-config file names. The final link takes the real
/// functions from rav1d instead.
fn install_dav1d_api(build: &Build, dir: &Path) {
    let include = build.prefix.join("include/dav1d");
    std::fs::create_dir_all(&include).unwrap();
    let headers = build.vendor.join(RAV1D).join("include/dav1d");
    for header in ["common.h", "data.h", "dav1d.h", "headers.h", "picture.h"] {
        std::fs::copy(headers.join(header), include.join(header)).unwrap();
    }
    let (major, minor, patch) = DAV1D_API_VERSION;
    let version = std::fs::read_to_string(headers.join("version.h.in"))
        .unwrap()
        .replace("@DAV1D_API_VERSION_MAJOR@", &major.to_string())
        .replace("@DAV1D_API_VERSION_MINOR@", &minor.to_string())
        .replace("@DAV1D_API_VERSION_PATCH@", &patch.to_string());
    std::fs::write(include.join("version.h"), version).unwrap();

    let stub = dir.join("stub.c");
    std::fs::write(&stub, "const char *dav1d_version(void) { return \"rav1d\"; }\n").unwrap();
    cc::Build::new()
        .file(&stub)
        .out_dir(dir)
        .cargo_metadata(false)
        .compile(DAV1D_STUB);
    let lib = build.prefix.join("lib");
    let archive = format!("lib{DAV1D_STUB}.a");
    std::fs::copy(dir.join(&archive), lib.join(&archive)).unwrap();

    let pkgconfig = lib.join("pkgconfig");
    std::fs::create_dir_all(&pkgconfig).unwrap();
    std::fs::write(
        pkgconfig.join("dav1d.pc"),
        format!(
            "prefix={}\nincludedir=${{prefix}}/include\nlibdir=${{prefix}}/lib\n\n\
             Name: dav1d\nDescription: rav1d's dav1d API (Pixvitta)\nVersion: 1.3.0\n\
             Cflags: -I${{includedir}}\nLibs: -L${{libdir}} -l{DAV1D_STUB}\n",
            build.prefix.display()
        ),
    )
    .unwrap();
}

fn pkg_config_path(prefix: &Path) -> OsString {
    std::env::join_paths([prefix.join("lib/pkgconfig"), prefix.join("share/pkgconfig")]).unwrap()
}

struct Build {
    vendor: PathBuf,
    sources: PathBuf,
    work: PathBuf,
    prefix: PathBuf,
    stamps: PathBuf,
    cc: PathBuf,
    cxx: PathBuf,
    pkg_config: PathBuf,
    meson: OsString,
    /// The versions and options of every library so far, so a change to one
    /// rebuilds those built after it.
    chain: String,
}

impl Build {
    fn new(vendor: &Path, sources: &Path, out: &Path, prefix: &Path) -> Build {
        println!("cargo:rerun-if-changed=build_media.rs");
        println!("cargo:rerun-if-env-changed=MESON");
        println!("cargo:rerun-if-env-changed=PKG_CONFIG");
        let stamps = prefix.join("stamps");
        std::fs::create_dir_all(&stamps).unwrap();
        Build {
            vendor: vendor.to_path_buf(),
            sources: sources.to_path_buf(),
            work: out.join("media-build"),
            prefix: prefix.to_path_buf(),
            stamps,
            cc: cc::Build::new().get_compiler().path().to_path_buf(),
            cxx: cc::Build::new().cpp(true).get_compiler().path().to_path_buf(),
            pkg_config: system_pkg_config(),
            meson: std::env::var_os("MESON").unwrap_or_else(|| "meson".into()),
            chain: String::new(),
        }
    }

    /// Runs `build(self, source, build_dir)` for the library in
    /// `vendor/<name>.tar.*`, unless it was built before with the same
    /// versions and options.
    fn step(&mut self, name: &str, options: &[&str], build: impl FnOnce(&Build, &Path, &Path)) {
        self.chain.push_str(&format!("{name} {}\n", options.join(" ")));
        // Watched even when the step is up to date, so replacing a tarball
        // under the same name still rebuilds it.
        for candidate in [name.to_string(), format!("{name}.tar.gz"), format!("{name}.tar.xz")] {
            let path = self.vendor.join(candidate);
            if path.exists() {
                println!("cargo:rerun-if-changed={}", path.display());
            }
        }
        let stamp = self.stamps.join(name);
        if std::fs::read_to_string(&stamp).is_ok_and(|built| built == self.chain) {
            return;
        }
        let _ = std::fs::remove_file(&stamp);
        let source = if self.vendor.join(name).is_dir() {
            self.vendor.join(name)
        } else {
            crate::extract(&self.vendor, &self.sources, name)
        };
        let dir = self.work.join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        build(self, &source, &dir);
        std::fs::write(&stamp, &self.chain).unwrap();
    }

    fn meson(&mut self, name: &str, options: &[&str]) {
        self.step(name, options, |build, source, dir| {
            let mut setup = build.command(&build.meson);
            setup
                .arg("setup")
                .arg(dir)
                .arg(source)
                .arg(format!("--prefix={}", build.prefix.display()))
                .args(["--libdir=lib", "--buildtype=release", "--default-library=static"])
                // No downloads: a library's optional subprojects (test tools,
                // fallbacks) are skipped instead of fetched.
                .args(["-Db_staticpic=true", "-Db_ndebug=true", "--wrap-mode=nodownload"])
                .args(options);
            build.run(&mut setup, &format!("meson setup for {name}"));
            let mut install = build.command(&build.meson);
            install.args(["install", "-C"]).arg(dir);
            build.run(&mut install, &format!("building {name}"));
        });
    }

    /// make with as many jobs as cargo was given. Cargo's jobserver isn't
    /// passed on: its file descriptors don't survive into the child, and
    /// ninja (under meson) refuses to start with them.
    fn make(&self, dir: &Path, args: &[&str]) {
        let mut make = self.command("make");
        make.args(args)
            .arg(format!("-j{}", std::env::var("NUM_JOBS").unwrap_or_else(|_| "1".into())))
            .current_dir(dir);
        self.run(&mut make, &format!("make in {}", dir.display()));
    }

    /// A command that sees the bundled libraries first, through the
    /// system's pkg-config.
    fn command(&self, program: impl AsRef<std::ffi::OsStr>) -> Command {
        let mut command = Command::new(program);
        command
            .env("PKG_CONFIG", &self.pkg_config)
            .env("PKG_CONFIG_PATH", pkg_config_path(&self.prefix))
            .env("CC", &self.cc)
            .env("CXX", &self.cxx)
            .env_remove("MAKEFLAGS")
            .env_remove("MFLAGS")
            .env_remove("CARGO_MAKEFLAGS");
        command
    }

    fn run(&self, command: &mut Command, what: &str) {
        crate::run(command, what);
    }
}

/// The system's pkg-config, which sees the system's libva, libdrm, EGL,
/// PulseAudio, ALSA and fontconfig. One that another package manager (such
/// as Homebrew) puts ahead on PATH doesn't, and would find its own copies.
/// The PKG_CONFIG environment variable still wins.
fn system_pkg_config() -> PathBuf {
    if let Some(path) = std::env::var_os("PKG_CONFIG") {
        return path.into();
    }
    ["/usr/bin/pkg-config", "/usr/bin/pkgconf"]
        .iter()
        .map(PathBuf::from)
        .find(|path| path.exists())
        .unwrap_or_else(|| "pkg-config".into())
}
