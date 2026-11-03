# Pixvitta

Pixvitta is a desktop image and video viewer for Linux and macOS. Open a folder
or a supported web page and browse its media in a filmstrip, without importing
anything into a library.

Pixvitta is under active development.

## Features

- Image viewing with zoom, trackpad gestures, and click-and-drag panning.
- Video playback with seeking, looping, and autoplay.
- One-at-a-time or continuous-scroll viewing, in a classic or immersive layout.
- A resizable filmstrip with cached thumbnails.
- Web sources: paste a 4chan thread or an E-Hentai, ExHentai, or nhentai
  gallery URL under **Open from the web** to browse and download its media.
  ExHentai requires signing in to the E-Hentai forums from inside the app.
- Recent sources, sorting options, fullscreen, and auto-hiding controls.

Folder scans are not recursive: only supported files at the top level of the
selected folder are shown.

## Supported Media

| Images | Video containers |
| --- | --- |
| JPEG, PNG, GIF, WebP, BMP, AVIF, SVG, ICO | MP4, M4V, MOV, WebM, OGV, OGG |

Video playback also depends on the codecs inside a file being supported by
Chromium.

## Install

Linux builds are available from [GitHub Releases](https://github.com/raulferrodrigues/pixvitta/releases)
in two editions that can be installed side by side: stable **Pixvitta** and
prerelease **Pixvitta Nightly**. Both update themselves automatically from
their own release channel.

**Debian, Ubuntu, and derivatives:**

```bash
sudo apt install ./Pixvitta-<version>-amd64.deb
```

**AppImage:**

```bash
chmod +x Pixvitta.AppImage
./Pixvitta.AppImage
```

**macOS:** there is no signed public release yet. Build an unsigned DMG locally
with `pnpm dist:mac`.

## Keyboard Shortcuts

| Action | Shortcut |
| --- | --- |
| Open folder | `Ctrl/Cmd + O` |
| Previous or next media | `Left` / `Right` |
| Play or pause video | `Space` or `K` |
| Toggle fullscreen | `F` |
| Settings | `Ctrl/Cmd + ,` |

Press `?` in the app for the full list.

## Development

Requires Node.js 24 and pnpm 12 (pnpm picks up the pinned version from `packageManager`).

```bash
pnpm install
pnpm electron:dev
```

| Command | Purpose |
| --- | --- |
| `pnpm test` | Run tests |
| `pnpm typecheck` | Type-check renderer and Electron code |
| `pnpm validate` | Run tests, type checking, and a production build |

See [Releasing and Versioning](docs/releasing.md) for packaging and the CI
release process, and [Media Provider Architecture](docs/media-provider-architecture.md)
for how media sources work.

## License

Pixvitta is licensed under the [GNU General Public License v3.0](LICENSE).
