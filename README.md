# Pixvitta

Pixvitta is a lightweight macOS and Linux image and video viewer built with Electron.

## Development

```bash
pnpm install
pnpm electron:dev
```

Run type checking and a production build:

```bash
pnpm validate
```

## Build an Installable App

Generate the app icon, build the app, and create macOS DMG/ZIP artifacts:

```bash
pnpm dist
```

Artifacts are written to `release/`.

On Linux, generate the AppImage and Debian package with:

```bash
pnpm dist:linux
```

Linux icon generation requires ImageMagick (`magick` or `convert`).

Run the AppImage directly after making it executable, or install the Debian
package with `sudo apt install ./release/Pixvitta-<version>-amd64.deb`. Linux
builds should be made on Linux so Electron Builder can use the host's packaging
tools reliably.

macOS install flow:

1. Open `release/Pixvitta-<version>-<arch>.dmg`.
2. Drag `Pixvitta.app` into `/Applications`.
3. Launch Pixvitta from Applications.

## Unsigned Build Notice

Current local builds are unsigned. macOS may warn that it cannot verify the developer.

Preferred workaround for your own machine:

1. Right-click `Pixvitta.app`.
2. Choose `Open`.
3. Confirm the macOS prompt.

Troubleshooting fallback:

```bash
xattr -dr com.apple.quarantine /Applications/Pixvitta.app
```

## Updates

Packaged Linux AppImage and Debian builds automatically check the public GitHub
Releases `dev` channel shortly after launch and every four hours while running.
Updates download in the background. Pixvitta then offers to restart immediately
or installs the downloaded update when the app is next quit. Debian updates
request administrator authentication before installing the new package.

The release asset is always named `Pixvitta.AppImage`, so AppImageLauncher desktop
entries continue to point at the integrated file after an update. The first install
is manual; subsequent development builds update in place.

Every push to `main` creates a prerelease through
`.github/workflows/linux-development-release.yml`. The workflow derives a version
newer than the stable version in `package.json`, validates the app, builds the
AppImage and Debian package, and publishes both with shared `dev-linux.yml`
update metadata.

macOS auto-updates remain disabled. Reliable macOS auto-updates require:

- Apple Developer Program membership.
- Developer ID Application signing.
- Apple notarization.
- GitHub Releases assets generated from signed builds.

Future signing/notarization environment variables:

```text
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
CSC_LINK
CSC_KEY_PASSWORD
GH_TOKEN
```

## Release Process

Current unsigned local release:

```bash
pnpm release:check
pnpm dist
```

Tagged macOS release build:

```bash
git tag v0.1.0
git push origin main --tags
```

The tag workflow builds DMG/ZIP artifacts. Public-ready macOS releases should enable signing and notarization first.

## License

Pixvitta is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE).
