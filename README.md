# Pixvitta

Pixvitta is a desktop image and video viewer for Linux and macOS. Open a folder,
browse its supported media in a filmstrip, and move between files without
importing them into a library. Viewing and thumbnail generation happen locally.

Pixvitta is under active development. Linux builds are published in two
side-by-side editions: stable **Pixvitta** and prerelease
**Pixvitta Nightly**.
macOS builds are unsigned development artifacts.

## Features

- Image viewing with zoom, trackpad gestures, and click-and-drag panning.
- Video playback, seeking, looping, autoplay, and optional native controls.
- A resizable, virtualized filmstrip with cached image and video thumbnails.
- Recent folders and support for opening an individual media file from the
  desktop or command line.
- Sorting by name, kind, access time, date added, modification time, creation
  time, size, or a stable random order.
- Optional hidden files, navigation wrapping, fullscreen viewing, and
  unobtrusive auto-hiding controls.
- Native context-menu actions to reveal or copy a media file and copy its path.

Folder scans are not recursive: Pixvitta displays supported files from the
selected folder's top level.

## Supported Media

| Images | Video containers |
| --- | --- |
| JPEG, PNG, GIF, WebP, BMP, AVIF, SVG, ICO | MP4, M4V, MOV, WebM, OGV, OGG |

Video decoding is provided by the Chromium runtime bundled with Electron, so
playback also depends on the codecs used inside a file.

## Install

Linux builds are available from [GitHub Releases](https://github.com/raulferrodrigues/pixvitta/releases).

### Debian, Ubuntu, Mint, and derivatives

The Debian package provides the most reliable desktop integration on supported
distributions. Install the downloaded package with APT so required system
libraries are resolved automatically.

Install stable Pixvitta:

```bash
sudo apt install ./Pixvitta-<version>-amd64.deb
```

Install Pixvitta Nightly:

```bash
sudo apt install ./Pixvitta-Nightly-<version>-amd64.deb
```

The packages can be installed and run at the same time. Pixvitta Nightly uses a
purple icon and an in-app `NIGHTLY` badge, and keeps its settings, recent
folders, thumbnail cache, updater data, and single-instance lock separate from
stable. Both editions appear in the desktop environment's **Open With** list;
installing Nightly does not intentionally change the default application.

Uninstall either edition independently:

```bash
sudo apt remove pixvitta
sudo apt remove pixvitta-nightly
```

### AppImage

The AppImage is the portable Linux build. Make it executable and run it directly:

```bash
chmod +x Pixvitta.AppImage
./Pixvitta.AppImage

chmod +x Pixvitta-Nightly.AppImage
./Pixvitta-Nightly.AppImage
```

Desktop integration for an AppImage is optional and is managed by the desktop
environment or a separate integration tool.

Former Pixvitta Dev packages used the `pixvitta-dev` package identity. They are
not the Nightly edition and can be removed with
`sudo apt remove pixvitta-dev`. Previously integrated development AppImages
should be removed from the integration tool and reintegrated using
`Pixvitta-Nightly.AppImage`. Pixvitta Nightly starts with fresh application data
and does not copy stable or local-development preferences.

### macOS

Pixvitta does not currently provide a signed and notarized public macOS release.
Developers can create an unsigned DMG and ZIP locally with `pnpm dist:mac`.

## Controls

| Action | Shortcut |
| --- | --- |
| Open folder | `Ctrl/Cmd + O` |
| Rescan current folder | `Ctrl/Cmd + R` |
| Open settings | `Ctrl/Cmd + ,` |
| Previous or next media | `Left` / `Right` |
| Play or pause video | `Space` or `K` |
| Seek video by 5 seconds | `J` / `L` |
| Toggle fullscreen | `F` |
| Leave fullscreen | `Esc` |
| Zoom the current image | `Ctrl/Cmd + =` / `Ctrl/Cmd + -` |

Images also support trackpad pinch-to-zoom. Once zoomed, scroll or drag to pan.

## Development

The project uses Electron, React, TypeScript, Vite, and pnpm. The CI environment
uses Node.js 24 and pnpm 10.

```bash
pnpm install
pnpm electron:dev
```

Local Electron development runs as Pixvitta Dev by default, including purple
branding and isolated application data. Pixvitta Dev is a local development
identity and is not published. Pushes to `dev` produce Pixvitta Nightly instead.

Useful commands:

| Command | Purpose |
| --- | --- |
| `pnpm test` | Run focused automated tests |
| `pnpm typecheck` | Type-check renderer and Electron code |
| `pnpm build` | Create production renderer and Electron bundles |
| `pnpm validate` | Run tests, type checking, and a production build |
| `pnpm dist:linux` | Build stable-channel AppImage and Debian packages |
| `pnpm dist:linux:nightly` | Build Nightly-channel AppImage and Debian packages |
| `pnpm dist:deb` | Build only the Debian package |
| `pnpm dist:deb:nightly` | Build only the Pixvitta Nightly Debian package |
| `pnpm dist:mac` | Build macOS DMG and ZIP artifacts |

Build artifacts are written to `release/`. Linux icon generation requires
ImageMagick (`magick` or `convert`), and platform packages should be built on
their target operating system.

## Automatic Updates

Stable Linux builds follow normal GitHub Releases on the `latest` channel.
Pixvitta Nightly follows prereleases on the `nightly` channel. Each edition
checks shortly after launch, every four hours while running, and when
**Check for Updates** is selected from the application menu. An edition only
installs updates from its own channel.

Updates download in the background. AppImage updates replace the running
AppImage in place. Debian updates install a new package and require administrator
authentication. Automatic updates are disabled for current unsigned macOS builds.

Pushes to `main` publish normal Pixvitta Linux releases using the version in
`package.json`. Pushes to `dev` publish versioned Pixvitta Nightly prereleases.
Both release types contain the corresponding AppImage, Debian package, and
update metadata.

## Project Structure

- `src/main` owns windows, filesystem access, media scanning, thumbnail caching,
  settings, native menus, and updates.
- `src/preload` exposes the narrow IPC bridge used by the interface.
- `src/renderer` contains the React viewer and settings interface.
- `src/shared` contains types and contracts shared across Electron processes.

## License

Pixvitta is licensed under the [GNU General Public License v3.0](LICENSE).
