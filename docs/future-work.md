# Future Work

Deferred items from the October 2026 project review. Each entry records the
problem and the proposed direction so it can be picked up without repeating
the investigation.

## Generic provider authentication

ExHentai sign-in leaks into code that is meant to be provider-neutral,
contrary to [Media Provider Architecture](media-provider-architecture.md):

- `src/renderer/state/viewerStore.ts` checks `hostname === "exhentai.org"` to
  remember which location to reopen after sign-in.
- The preload API and IPC expose a dedicated `signInExHentai` /
  `exhentai:sign-in`.
- Shared E-Hentai code contains hardcoded "Sign in to ExHentai" messages.

Proposed direction: providers declare that they support authentication, the
`authentication-required` source error identifies the sign-in to run, the
renderer shows a generic sign-in action, and main runs the provider's sign-in
before reopening the source.

Trigger: the second provider that requires sign-in.

## Recoverable renderer handoff

`MediaLibrary` exits the app with `app.exit(1)` when the renderer does not
acknowledge a committed collection within one second
(`src/main/library/mediaLibrary.ts`, `src/main/library/librarySession.ts`).
This is deliberate (see the
[post-mortem](authoritative-media-library-postmortem.md)) and has not been hit
in practice, but it can trigger without a real protocol bug:

- the renderer crashes or reloads during the acknowledgement window;
- on macOS, the main window closes between delivery and acknowledgement;
- a very large collection takes more than a second to render.

Separately, a renderer reload at any time leaves main holding the active
collection while the renderer shows the source picker.

Proposed direction: keep the fatal exit in development builds. In production,
log the failure and recover by returning the library to idle, and on
`render-process-gone` / `did-start-loading`, republish the active collection
once the renderer is ready again.
