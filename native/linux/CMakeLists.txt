cmake_minimum_required(VERSION 3.22)
project(pixvitta LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Qt and libmpv come from the system's packages, which only the system's
# pkg-config sees. Look for it in the system directories first, so one that
# another package manager (such as Homebrew) puts ahead on PATH isn't used.
# Qt's package files call pkg-config too, so this comes before them.
# -DPKG_CONFIG_EXECUTABLE or the PKG_CONFIG environment variable still win.
if("$ENV{PKG_CONFIG}" STREQUAL "")
    find_program(PKG_CONFIG_EXECUTABLE NAMES pkg-config pkgconf
        PATHS /usr/bin /bin NO_DEFAULT_PATH)
endif()

find_package(Qt6 6.4 REQUIRED COMPONENTS Gui OpenGL Qml Quick)
find_package(Threads REQUIRED)
find_package(PkgConfig)
if(NOT PKG_CONFIG_FOUND)
    message(FATAL_ERROR "pkg-config not found. Install it (on Ubuntu: sudo apt install pkg-config).")
endif()
pkg_check_modules(MPV IMPORTED_TARGET mpv)
if(NOT MPV_FOUND)
    message(FATAL_ERROR "${PKG_CONFIG_EXECUTABLE} can't find libmpv. Install its development package "
        "(on Ubuntu: sudo apt install libmpv-dev), or pass -DPKG_CONFIG_EXECUTABLE=<pkg-config that sees it>.")
endif()

qt_standard_project_setup()

# The Rust core, built by cargo as a static library. Cargo decides what is
# out of date, so the step runs on every build and is quick when nothing
# changed.
set(PIXVITTA_CORE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../core")
set(PIXVITTA_CORE_TARGET_DIR "${CMAKE_CURRENT_BINARY_DIR}/cargo")
set(PIXVITTA_CORE_LIB "${PIXVITTA_CORE_TARGET_DIR}/release/libpixvitta_core.a")
find_program(CARGO cargo HINTS "$ENV{HOME}/.cargo/bin")
if(NOT CARGO)
    # rustup installed by a package manager (Homebrew, for one) doesn't put
    # cargo on PATH or in ~/.cargo/bin, so ask rustup where its toolchain is.
    find_program(RUSTUP rustup HINTS "$ENV{HOME}/.cargo/bin")
    if(RUSTUP)
        execute_process(COMMAND "${RUSTUP}" which cargo
            WORKING_DIRECTORY "${PIXVITTA_CORE_DIR}"
            OUTPUT_VARIABLE PIXVITTA_RUSTUP_CARGO
            OUTPUT_STRIP_TRAILING_WHITESPACE
            ERROR_QUIET)
        if(EXISTS "${PIXVITTA_RUSTUP_CARGO}")
            set(CARGO "${PIXVITTA_RUSTUP_CARGO}" CACHE FILEPATH "Path to cargo." FORCE)
        endif()
    endif()
endif()
if(NOT CARGO)
    message(FATAL_ERROR "cargo not found. Install Rust through rustup (https://rustup.rs) and run "
        "'rustup default stable', or pass -DCARGO=/path/to/cargo.")
endif()
# Cargo finds rustc on PATH, which may not hold the toolchain CARGO points at.
get_filename_component(PIXVITTA_CARGO_DIR "${CARGO}" DIRECTORY)
find_program(RUSTC rustc HINTS "${PIXVITTA_CARGO_DIR}" REQUIRED)

add_custom_target(pixvitta_core_build
    COMMAND "${CMAKE_COMMAND}" -E env "RUSTC=${RUSTC}"
        "${CARGO}" build --release
        --manifest-path "${PIXVITTA_CORE_DIR}/Cargo.toml"
        --target-dir "${PIXVITTA_CORE_TARGET_DIR}"
    BYPRODUCTS "${PIXVITTA_CORE_LIB}"
    USES_TERMINAL
)

add_library(pixvitta_core STATIC IMPORTED)
set_target_properties(pixvitta_core PROPERTIES
    IMPORTED_LOCATION "${PIXVITTA_CORE_LIB}"
    INTERFACE_INCLUDE_DIRECTORIES "${PIXVITTA_CORE_DIR}/include"
)
add_dependencies(pixvitta_core pixvitta_core_build)
# The core calls libmpv; a static library can't carry that link itself.
target_link_libraries(pixvitta_core INTERFACE PkgConfig::MPV Threads::Threads ${CMAKE_DL_LIBS} m)

qt_add_executable(pixvitta
    src/main.cpp
)

qt_add_qml_module(pixvitta
    URI Pixvitta
    VERSION 1.0
    RESOURCE_PREFIX /qt/qml
    QML_FILES
        qml/Main.qml
    SOURCES
        src/imageprovider.h src/imageprovider.cpp
        src/mediafolder.h src/mediafolder.cpp
        src/videoitem.h src/videoitem.cpp
)

# The generated QML type registrations include the headers by name.
target_include_directories(pixvitta PRIVATE src)

target_link_libraries(pixvitta PRIVATE
    Qt6::Gui
    Qt6::OpenGL
    Qt6::Qml
    Qt6::Quick
    pixvitta_core
)
