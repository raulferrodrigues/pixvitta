# Nightly Releases

## Goal

Every push to `dev` publishes a purple-branded **Pixvitta Nightly** Linux
release. Nightly and stable must install side by side, keep separate application
data, and update only from their own release channels.

Local development remains **Pixvitta Dev**. It is started with
`pnpm electron:dev`, is not a published product, and keeps its existing
development-only identity and data directory.

## Decisions

- Stable remains **Pixvitta** on the `latest` updater channel.
- Local development remains **Pixvitta Dev** with the purple icon.
- Published builds from `dev` are **Pixvitta Nightly**, also with the purple
  icon.
- Nightly uses its own application ID, executable, package name, desktop file,
  updater cache, artifact names, updater metadata, and `nightly` channel.
- Nightly versions use the prerelease form
  `<next-patch>-nightly.<workflow-run>.<attempt>`.
- Each push to `dev` creates a GitHub prerelease for that Nightly version.
- Stable and Nightly builds must not share application data or updater state.
- Existing **Pixvitta Dev** packages are treated as the former published
  experiment. Nightly starts with a new isolated identity rather than taking
  over a local-development identity.

## Implementation

- [x] Add `nightly` as a build flavor while retaining `dev` for local runs.
- [x] Give Nightly its own product and storage identity.
- [x] Generate Nightly versions and Linux packages from `dev` pushes.
- [x] Publish Nightly artifacts and `nightly-linux.yml` on the `nightly`
      updater channel.
- [x] Update updater-channel tests and Linux package verification.
- [x] Validate tests, typechecking, and production builds.

## Current scope

Linux AppImage and Debian packages are included because those are the package
formats with automatic update support today. macOS Nightly packaging remains
out of scope until signed and notarized macOS updates are available.
