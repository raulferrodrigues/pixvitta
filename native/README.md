# Pixvitta native

The native rewrite described in [`docs/native-app-plan.md`](../docs/native-app-plan.md).
For now it is a thin slice: open a folder, show its images fitted to the
window, step through them, and play videos through libmpv.

- `core/`: the Rust core, built as a static library with a plain C API
  ([`core/include/pixvitta.h`](core/include/pixvitta.h)). It lists folders,
  decodes images to sRGB RGBA, and owns the libmpv player.
- `linux/`: the Linux app, Qt 6 and QML with a thin C++ layer over the C API.
  Video is drawn by libmpv into a `QQuickFramebufferObject`.

## Linux

Needs Rust (through rustup), CMake, a C++17 compiler, and the system's Qt 6
and libmpv. On Ubuntu 24.04 or Linux Mint 22:

```sh
sudo apt install cmake g++ pkg-config qt6-base-dev qt6-declarative-dev libmpv-dev \
    qml6-module-qtquick qml6-module-qtqml qml6-module-qtqml-models qml6-module-qtqml-workerscript
```

Build from the repository root. CMake runs cargo for the core.

```sh
cmake -S native/linux -B native/linux/build -DCMAKE_BUILD_TYPE=Release
cmake --build native/linux/build -j
```

Add to the first command when needed:

- `-DCARGO="$(rustup which cargo)"` if `cargo` is not on `PATH`.
- `-DPKG_CONFIG_EXECUTABLE=/usr/bin/pkg-config` if another `pkg-config`
  (Homebrew's, for example) comes first on `PATH` and can't find libmpv.

Run it on a folder:

```sh
native/linux/build/pixvitta path/to/folder
```

Left and Right step through the files, and Space plays or pauses a video.
