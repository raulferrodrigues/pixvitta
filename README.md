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

## Build An Installable App

Generate the app icon, build the app, and create macOS DMG/ZIP artifacts:

```bash
pnpm dist
```

Artifacts are written to `release/`.

On Linux, generate AppImage and Debian package artifacts with:

```bash
pnpm dist:linux
```

Run the AppImage directly after making it executable, or install the generated
`.deb` with your distribution's package installer. Linux builds should be made
on Linux so Electron Builder can use the host's packaging tools reliably.

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

The app includes `Pixvitta > Check for Updates...`, but automatic updates are intentionally disabled for unsigned builds.

Reliable macOS auto-updates require:

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

Future GitHub release:

```bash
git tag v0.1.0
git push origin main --tags
```

The GitHub Actions workflow builds DMG/ZIP artifacts for tag pushes. Public-ready auto-updating releases should enable signing and notarization first.

## License

Pixvitta is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE).
