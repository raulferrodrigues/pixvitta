# Future Work

Deferred items from the October 2026 project review. Each entry records the
problem and the proposed direction so it can be picked up without repeating
the investigation.

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
