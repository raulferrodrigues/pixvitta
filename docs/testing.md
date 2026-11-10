# Testing

This strategy is built for coding agents first. An agent needs three things from
a test suite: a fast answer about its own change, a failure it can diagnose
without a human, and a way to look at the running app. People benefit from the
same things.

The working procedure for agents is in
[`.agents/skills/test-pixvitta`](../.agents/skills/test-pixvitta/SKILL.md). This
document explains the design.

## Layers

Each layer fakes exactly one boundary and keeps everything inside it real.

| Layer | Real | Faked | Runs in | Run with | Time |
| --- | --- | --- | --- | --- | --- |
| **Spec** | One module | Its injected dependencies | Node | `pnpm test` | ~1s total |
| **Flow** | Library, providers, broker, disk cache, downloads | The web, pacing delays | Node | `pnpm test` | ~1s total |
| **Stage** | The whole React app and store | `window.pixvitta` | Chromium | `pnpm test:stage` | ~5s |
| **E2E** | Everything, in Electron, on a real wire | The world: fixture folders, fake https | Electron | `pnpm test:e2e` | ~6s |

Run `pnpm verify` and it picks the layers your diff can affect. CI runs all of
them on every pull request.

### Where does a test go?

Choose the lowest layer that can see the behavior.

| The behavior is... | Layer | Example |
| --- | --- | --- |
| A rule inside one module with a clear contract | Spec | Scheduler priorities, HTML parsing, version bumps |
| What crosses the wire, in what order, across modules | Flow | Prefetch order, refresh revalidation, 429 halting everything |
| What the UI does with what main tells it | Stage | Acknowledging collections, retrying failed media, virtualization |
| Something only the real pieces can prove | E2E | Pixels through the custom protocol, Range seeks, real pacing, native keys, restarts |

Tests are for things with a defined spec or shape that are likely to be
reimplemented. Skip anything a type checker catches, anything that restates
markup, and anything that only proves the app launches. Launching is a side
effect of every E2E test.

## Principles

**Fake the boundary, not the logic.** `FakeWeb`
([`src/main/testing/fakeWeb.ts`](../src/main/testing/fakeWeb.ts)) is the one
definition of the internet for every layer. Flow tests call it as the broker's
fetch. E2E tests serve it over loopback, and a session-level `https` handler
routes the real app to it with no test code in production paths. A route written
once works at both layers.

**Nothing reaches a real provider.** Providers have strict rate limits, and a 429
quits the app by design. Spec and flow bundles have no network at all. E2E tests
and `pnpm app` answer every https request from the fake web, and a URL with no
route fails the test instead of quietly going elsewhere.

**Rate limits are checked, not assumed.** Each flow test checks every request
against a table of upstream limits in
[`libraryHarness.ts`](../src/main/testing/libraryHarness.ts). The scheduler tests
prove that a policy's delay is applied, and one E2E test measures real gaps on the
wire. A new upstream has to be added to the table, which means looking up its
limits. Instant pacing exists only in test bundles, swapped in at bundle time, so
the app has no switch that could turn rate limiting off.

**Wait on what happens, never on the clock.** There are no sleeps. Flow tests
wait on requests through `web.waitFor`, and hold a request open with `createGate`
to make races deterministic. Stage and E2E tests wait through `expect`. If a test
needs a timeout to pass, the test is wrong or the app has a bug. There are no
retries either, because a retry would hide exactly the races these tests exist to
find. A hung test fails on a timeout in every layer, so no command can stall.

**Tests describe behavior, and one file knows the markup.** An earlier E2E suite
asserted on DOM details directly. It broke on every renderer refactor, was paused,
and was finally deleted. Now every selector lives in
[`tests/support/viewer.ts`](../tests/support/viewer.ts), so a UI change updates one
file and a spec only changes when behavior does.

**A failure explains itself.** A failed E2E test writes one `diagnostics.md` with
the error, the screen as an ARIA tree, the app's output, and every request, plus a
screenshot beside it. An agent can read all of that without a trace viewer.

**Everything is sandboxed.** Each test gets its own userData and downloads
directories. Linux runs use a virtual display, so no window steals focus from
whoever is at the desktop. Each worktree has its own stable stage port, so parallel
agents do not collide.

## Selecting tests by import graph

`pnpm test` accepts paths and maps them to tests through esbuild's metafile, which
already records what each test bundle imports:

```bash
pnpm test --changed                         # tests the current diff can reach
pnpm test src/main/requestBroker/scheduler.ts   # tests that import this file
pnpm test src/main/library --name "429"     # narrowed by test name
```

This also means a harness change selects every test that uses it, with no
dependency map to maintain. `package.json` and the lockfile select everything.

## The stage

The stage is the real renderer against a scripted main process. `stage.html` boots
the normal entry point after installing a fake `window.pixvitta`
([`stageApi.ts`](../src/renderer/stage/stageApi.ts)), so the fake has to satisfy the
same `PixvittaApi` type as the preload script. It also enforces the one protocol
rule the renderer can break: every collection acknowledged exactly once. The real
app quits on a violation; the stage records it.

[Scenarios](../src/renderer/stage/scenarios.ts) are named starting states, opened
with `/stage.html?scenario=<name>`. They reach what is tedious by hand: a 5,000-item
gallery, every download state, and every source error. Stage tests run them in a
bare Electron window ([`tests/stage/host.cjs`](../tests/stage/host.cjs)), so they use
the Chromium that ships with the app and need no browser download. None of this is
imported by `index.html`, so it never reaches a production build.

## The app driver

`pnpm app` keeps the real app running in a sandbox and takes one command at a time:
open a source, read the screen, press a key, take a screenshot, evaluate in either
process, read the logs and requests. It shares its launcher with the E2E tests, so
what an agent sees while exploring is what a test would see. Run `pnpm app help` for
the commands.

## T3 Code integration

| T3 Code feature | How Pixvitta uses it |
| --- | --- |
| Worktree by default | `t3.json` sets `defaultThreadEnvMode` to `worktree`, so each new thread works in its own checkout with its own sandbox and stage port. |
| Worktree setup script | `t3.json` installs dependencies and Electron, and holds the agent until they are ready, so a new worktree can run tests right away. |
| Preview tools | `preview_open` on the stage's port shows the real UI in a tab the user can watch, driven with `preview_snapshot`, `preview_act`, and `preview_evaluate` on `window.pixvittaStage`. |
| Scripts menu | One click each for Verify Diff, Stage, and E2E Tests. |
| Settle hooks | The stage stops and `pnpm app stop` runs when a thread settles, so nothing outlives the work. |
| Skills | `.agents/skills/test-pixvitta` teaches the workflow, and `.claude/skills` links to it so every provider finds it. |
| Inline images | `pnpm app screenshot` and failure screenshots print a path an agent can embed in its reply. |

### What came from T3 Code's own repository

- Run the smallest proof locally and let CI own the full suite.
- Fake at the adapter boundary, as its `TestProviderAdapter` does, and keep the
  orchestration real.
- Wait on signals, never on sleeps. A test that needs a timeout is wrong.
- Give each worktree isolated state and a port derived from its path.
- Teach the run-and-verify workflow as a skill that includes how to stay safe:
  never kill by pattern, and never write to the live install.

## Continuous integration

The Validate workflow has three jobs on every pull request. *Test, typecheck, and
build* runs `pnpm validate`, the same command the release builds run. *Stage and
E2E tests* runs both Playwright projects on Linux under `xvfb` and uploads
`test-results/` when something fails. *Native corpus check* runs the native
core's corpus check (`native/README.md`) against Ubuntu's libmpv.

## Known limits

- T3 Code's `preview_snapshot`, `preview_act`, and `preview_wait_for` need a tab that
  can render. On Linux, `t3 browser setup` prepares the host for that once. Where
  they still time out, `preview_navigate` and `preview_evaluate`
  still work, and `pnpm app snapshot` and `pnpm app screenshot` cover looking at the app.
- Stage and E2E tests run on Linux in CI. Run them by hand before relying on
  macOS-specific behavior; on macOS their windows are visible.
- E2E runs the unpackaged build. `scripts/verify-linux-package.mjs` covers package
  contents, but nothing launches a packaged app.
- Flow tests and the E2E limits cover 4chan and nhentai. E-Hentai and ExHentai have
  spec coverage of their sessions, but no fake site yet, because they need
  authenticated HTML pages. The next flow test should add one.
