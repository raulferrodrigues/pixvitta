# Pixvitta

Pixvitta is a desktop image and video viewer for Linux and macOS. Open a folder
or a supported web page, browse its media in a filmstrip, and move between files
without importing them into a library. Local viewing and thumbnail generation
happen on your computer.

Pixvitta is under active development. Linux builds are published in two
side-by-side editions: stable **Pixvitta** and prerelease
**Pixvitta Nightly**.
macOS builds are unsigned development artifacts.

## Features

- Image viewing with zoom, trackpad gestures, and click-and-drag panning.
- Video playback, seeking, looping, autoplay, and optional native controls.
- A resizable, virtualized filmstrip with cached image and video thumbnails.
- Web sources: paste a 4chan thread, E-Hentai gallery, or ExHentai gallery URL
  under **Open from the web**. Pixvitta fetches media with conservative,
  per-site request pacing, prefetches around the current item, and can
  download the current item or the whole collection. ExHentai requires signing
  in to the E-Hentai forums from inside the app.
- Recent sources, including web sources, and support for opening an individual
  media file from the desktop or command line.
- Sorting by name, kind, access time, date added, modification time, creation
  time, size, or a stable random order.
- Optional hidden files, navigation wrapping, fullscreen viewing, and
  unobtrusive auto-hiding controls.
- Native context-menu actions to reveal or copy a local media file and copy its
  path, or to download remote media and copy its URL.

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
sources, thumbnail cache, updater data, and single-instance lock separate from
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
| Refresh current source | `Ctrl/Cmd + R` |
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

Pushes to `main` publish normal Pixvitta Linux releases, and pushes to `dev`
publish Pixvitta Nightly prereleases. Both release types contain the
corresponding AppImage, Debian package, and update metadata. See
[Versioning](#versioning) for how their versions are chosen.

## Versioning

CI owns the version. Nobody edits the version in `package.json` by hand, in a
pull request or anywhere else. Versions use the form `X.Y.Z`:

| Event | Bump | Example |
| --- | --- | --- |
| A pull request merges into `dev` (or a direct push to `dev`) | `Z` | `0.4.2` → `0.4.3` |
| `dev` merges into `main` | `Y`, and `Z` resets | `0.4.3` → `0.5.0` |
| `dev` merges into `main` with the `release:major` label | `X` | `0.5.3` → `1.0.0` |
| A pull request straight into `main` with the `release:hotfix` label | `Z` on `main` | `0.5.0` → `0.5.1` |

How it works:

- **Nightly** (`.github/workflows/nightly.yml`) runs on every push to `dev`. It
  commits the `Z` bump to `dev`, then builds that commit and publishes it as a
  Pixvitta Nightly prerelease, `X.Y.Z-nightly.<run>.<attempt>`.
- **Stable** (`.github/workflows/stable.yml`) runs on every push to `main`. It
  computes the release version from the last release on `main`, commits it as
  `Release vX.Y.Z`, builds that commit, and publishes a normal Pixvitta
  release. It then merges `main` back into `dev`, so `dev` carries the release
  forward and the next `dev` into `main` merge has no version conflict.
- After a hotfix, `dev` never moves backwards, or Nightly users would stop
  receiving updates. `dev` takes the higher of its own next patch and the
  release: `0.5.3` with hotfix `0.5.1` becomes `0.5.4`. A `dev` with nothing
  new since the release takes the hotfix version.
- A pull request straight into `main` must have `release:hotfix` (or
  `release:major`). The **Version Check** workflow fails it without one, and the
  Stable workflow refuses to release it if it is merged anyway: add the label
  to the merged pull request and re-run the workflow. Pushing a local `dev`
  into `main` merge without a pull request is a normal minor release.
- Every platform build uses the version commit CI made, so `package.json`
  always holds the real version. Code reads it with `app.getVersion()` in the
  main process, or `buildInfo.version` in the renderer.
- The version rules live in `scripts/release-version.mjs`, with tests.

What this means when contributing:

- Every pull request into `dev` or `main` runs the **Validate** workflow
  (`pnpm validate`: tests, typechecking, and the production build). Merge only
  when it passes.

- Do not change the version in a pull request. The **Version Check** workflow
  fails pull requests that do, and CI discards the edit if one is merged
  anyway.
- Pull after every merge before pushing again. CI pushes a version commit to
  `dev` after each merge, and to `main` and `dev` after each release.
- Label the pull request before merging it. The label is read once, when the
  merge lands, and a published version cannot be taken back.
- If a hotfix conflicts with code on `dev`, the release still ships but the
  Stable workflow's **Merge the release back into dev** job fails and lists the
  files. Merge `main` into `dev` by hand, resolve those files, and leave the
  `package.json` version to CI.

## Project Structure

- `src/main` owns windows, filesystem access, media providers, the request
  broker and resource cache, thumbnail caching, settings, native menus, and
  updates. See [Media Provider Architecture](docs/media-provider-architecture.md).
- `src/preload` exposes the narrow IPC bridge used by the interface.
- `src/renderer` contains the React viewer and settings interface.
- `src/shared` contains types and contracts shared across Electron processes.

## License

Pixvitta is licensed under the [GNU General Public License v3.0](LICENSE).
