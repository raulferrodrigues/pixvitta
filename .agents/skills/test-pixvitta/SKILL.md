---
name: test-pixvitta
description: Run, drive, and verify Pixvitta in isolated sandboxes. Use when checking a change works, reproducing a bug in the real app, looking at the UI, choosing where a new test belongs, or reading a test failure. Covers pnpm verify, the T3 Code preview workflow for the renderer stage, and the pnpm app driver for the real Electron app.
---

# Test Pixvitta

`docs/testing.md` explains the layers and why they exist. This is the working
procedure.

## Prove a change

Run `pnpm verify`. It reads your diff and runs only the layers that diff can
affect. `pnpm verify --plan` shows what it would run. Do not run everything by
hand unless asked; CI owns the full suite.

To narrow further while iterating:

| Goal | Command |
| --- | --- |
| Tests that reach a source file or directory | `pnpm test src/main/requestBroker/scheduler.ts` |
| One test by name | `pnpm test src/main/library --name "429"` |
| One stage or E2E spec | `pnpm test:stage tests/stage/viewer.spec.ts --grep "settings"` |

## Read a failure

An E2E failure prints a `Diagnostics:` path. Read that one file: it holds the
error, the screen as an ARIA tree, the app's output, and every request. A
`screenshot.png` sits next to it; embed it in your reply if the user should see
it. Stage failures have an `error-context.md` in `test-results/`.

A flaky test is a bug in the test or the app. Never add a retry or a sleep. Wait
on something the app does: a request through `web.waitFor`, or a screen state
through `expect`.

## See the UI in a T3 Code preview tab

Use this for layout, styling, and renderer behavior. It needs no Electron, and
the user can watch the same tab. Only do it when the request involves looking
at the UI or asks for browser work.

1. Start the stage in the background and read the port from Vite's output. It is
   stable for this worktree, so a later turn can reuse it if the process is alive:
   ```bash
   pnpm dev:stage
   ```
2. Open a scenario: `preview_open` with
   `target: { kind: "environment-port", port: <port>, path: "/stage.html?scenario=folder" }`.
3. Look with `preview_snapshot`, then act with `preview_act` using its `aria-ref`
   locators. Change scenarios with `preview_navigate`.
4. Use `preview_evaluate` on `window.pixvittaStage` for what no click can reach:
   ```js
   window.pixvittaStage.sendCommand("next-media")     // a menu command from main
   window.pixvittaStage.showSourceError("rate-limited")
   window.pixvittaStage.callsTo("setSelectedMedia")   // what the UI asked of main
   window.pixvittaStage.violations                    // broken protocol, must be empty
   ```
   If `preview_snapshot`, `preview_act`, or `preview_wait_for` time out, which
   happens when the tab cannot render on this host, keep going with `preview_evaluate`
   alone: it can click elements and read the DOM. To get a picture, use the real app
   below. Tell the user the preview tools were limited.
5. Close your tab with `t3_preview_close` and stop the stage when the work is done.
   Keep them while the user may still ask for changes.

Scenarios live in `src/renderer/stage/scenarios.ts`: `empty`, `recents`, `folder`,
`large-gallery`, `broken-media`, `loading-replacement`, `downloads`, and
`error-<code>` for each source error. If a state is hard to reach, add a scenario.

The stage has no main process. Custom protocols, IPC, the filesystem, native
keys, and the broker are not there, so use the real app for those.

## Drive the real app

Use this to reproduce a bug or confirm anything involving main, preload, the media
protocol, thumbnails, downloads, or native input. It builds and runs the real app
on a virtual display, so no window appears on the user's desktop.

```bash
pnpm app start --fresh
pnpm app open sample-folder     # or sample-thread, sample-gallery, or any path
pnpm app snapshot               # the screen as an ARIA tree
pnpm app native-key Right       # through main, like a physical key press
pnpm app click filmstrip-item-2 # by data-testid or visible text
pnpm app screenshot             # prints a PNG path you can embed in your reply
pnpm app eval 'document.title'  # in the renderer
pnpm app main 'electron.app.getPath("userData")'
pnpm app logs
pnpm app requests               # what it asked the fake web for
pnpm app stop
```

The app stays up between tool calls, and `pnpm app start` rebuilds, so restart it
to pick up code changes. T3 Code runs `pnpm app stop` when a thread settles. `pnpm
app help` lists every command.

## Stay safe

1. **Never reach a real provider.** Every layer answers https from a fake web, and
   providers have strict rate limits. A 429 halts and quits the app on purpose. To
   test against a provider's behavior, add its responses to
   `src/main/testing/fakeWeb.ts`. Only ever run `pnpm electron:dev` against real
   sites when the user asks.
2. **Never touch real user data.** Sandboxes live in `.tmp/app` and `test-results`.
   Do not point anything at `~/.config/Pixvitta*`. Reading a real media folder with
   `pnpm app start --folder <path>` is fine, because the app never writes to it.
3. **Never kill by pattern.** No `pkill` or killing a PID found by name: other
   worktrees run their own apps and your own agent process has this path in its
   arguments. Use `pnpm app stop`, or the PID of a process you started.
4. **Use the background for slow work.** Run long commands with `run_in_background`
   and `t3_background_wait` rather than sleeping.

## Add a test

Pick the lowest layer that can see the behavior, using the table in
`docs/testing.md`. Selectors belong in `tests/support/viewer.ts`, never in a spec.
Do not write smoke tests or tests that restate markup.
