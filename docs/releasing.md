# Releasing and Versioning

Pushes to `main` publish normal Pixvitta Linux releases on the `latest` update
channel, and pushes to `dev` publish Pixvitta Nightly prereleases on the
`nightly` channel. Both release types contain the AppImage, Debian package, and
update metadata.

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

## Contributing

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

## Building packages locally

| Command | Purpose |
| --- | --- |
| `pnpm dist:linux` | Build stable-channel AppImage and Debian packages |
| `pnpm dist:linux:nightly` | Build Nightly-channel AppImage and Debian packages |
| `pnpm dist:deb` | Build only the Debian package |
| `pnpm dist:deb:nightly` | Build only the Pixvitta Nightly Debian package |
| `pnpm dist:mac` | Build unsigned macOS DMG and ZIP artifacts |

Build artifacts are written to `release/`. Linux icon generation requires
ImageMagick (`magick` or `convert`), and platform packages should be built on
their target operating system.

The icons themselves are drawn by `pnpm icon:design`, which writes the SVG and
1024px PNG for each flavor (stable, nightly, dev) into `assets/`. Run it after
changing `scripts/design-icon.mjs` and commit what it writes; packaging only
resizes those PNGs.
