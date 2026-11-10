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
- Mixes: add more folders, threads, or galleries to what is open and browse
  them as one stream, one item from each source in turn. The sources panel
  (`Ctrl/Cmd + B`) lists the sources in the mix, adds one from a URL, a path,
  a folder, or your recent sources, and removes one. A source that fails to
  refresh keeps its items and shows why on its row. Opening a source while a
  mix is open asks before replacing it.
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
prerelease **Pixvitta Nightly**. Each checks its own release channel in the
background. When an update is found, the gear button gets a dot, and the
Updates row at the bottom of Settings downloads it and restarts into it. A
downloaded update also installs when you quit.

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
| Add folder to the mix | `Ctrl/Cmd + Shift + O` |
| Show or hide sources | `Ctrl/Cmd + B` |
| Previous or next media | `Left` / `Right` |
| Play or pause video | `Space` or `K` |
| Toggle fullscreen | `F` |
| Settings | `Ctrl/Cmd + ,` |

Press `?` in the app for the full list.

## Development

Requires pnpm and any Node.js 22 or newer to start it. `package.json` pins pnpm
(`packageManager`) and Node (`devEngines.runtime`, locked to an exact version in
`pnpm-lock.yaml`), and pnpm switches to both on its own: `pnpm install` downloads
the pinned Node and every `pnpm` script runs on it.

```bash
pnpm install
pnpm electron:dev
```

| Command | Purpose |
| --- | --- |
| `pnpm verify` | Run the checks your diff can affect |
| `pnpm test` | Run spec and flow tests; accepts paths, `--changed`, and `--name` |
| `pnpm test:stage` | Run renderer tests against a fake main process |
| `pnpm test:e2e` | Run the real app against fixture folders and a fake web |
| `pnpm dev:stage` | Serve the renderer at `/stage.html` for use in a browser |
| `pnpm app` | Drive the real app in a sandbox, one command at a time |
| `pnpm typecheck` | Type-check renderer, Electron, and test code |
| `pnpm validate` | Run tests, type checking, and a production build |

See [Testing](docs/testing.md) for how the test layers fit together, [Releasing and Versioning](docs/releasing.md) for packaging and the CI
release process, and [Media Provider Architecture](docs/media-provider-architecture.md)
for how media sources work.

## License

Pixvitta is licensed under the [GNU General Public License v3.0](LICENSE).
