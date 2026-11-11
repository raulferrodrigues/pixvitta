# AGENTS.md

Pixvitta is an image and video viewer for macOS and Linux, built on Electron. Use `pnpm` for project commands.

## How to work

- Prefer simple systems and behavior that feels obvious. Understand the real constraint, then pick the smallest model that makes the correct behavior unsurprising.
- Do not keep complexity because it already exists, and do not add machinery because it looks impressive.
- Fight scope creep. Do what the user asked, in the smallest realistic way.
- When there are several good solutions (tech choices, artifact shapes), ask the user. Do not ask about implementation details unless the user asks you to.
- If a rule in this file fights the task, say so and get the user's sign-off before breaking it.

## Glossary

Use these words consistently, in code and with the user.

- **Source**: the canonical place a provider loads, such as a local directory or a thread or gallery URL. "Folder" is the user-facing word for a local-directory source only.
- **Provider**: an adapter in `src/main/library/providers/` that accepts a location, loads it into a collection, and serves its resources: `localFolder`, `fourChan`, `eHentai`, `exHentai`, and `nhentai`.
- **Collection**: a loaded snapshot of media items from one or more sources. The media library in main owns the active collection; the renderer only shows the latest one it was given.
- **Mix**: a collection made of several sources, interleaved in zipper order. Mixes are saved automatically and listed with recents.
- **Request broker**: the only component that sends provider network requests (`src/main/requestBroker`). It enforces each provider's rate limits.
- **Layout**: how the viewer is arranged, `classic` or `immersive`.
- **Stage**: the renderer running in a browser against a fake main process, for stage tests and preview tabs (`pnpm dev:stage`).
- **Sandbox app**: the real Electron app driven by `pnpm app`, living under `.tmp/app` and answering from the fake web.
- **Native app**: the Rust core with Qt and Swift UIs in `native/` that will replace Electron. The Electron app keeps shipping meanwhile.

## Code

- Prefer inferred types over annotations. Never use `any`.
- Never prefix a variable with `_`.
- Comments describe how a thing is used, and move when the code moves. Put them mostly on functions; do not narrate every line.
- Nothing animates continuously while the app is idle; it pegs the GPU on high-refresh displays. A spinner runs only while work is in flight.
- Before adding a web request of any kind, find out how many requests the service allows and how fast. Always respect those limits.

## Testing

Write a test only when both are true: the thing has a defined spec, shape, or well-described behavior, and its implementation is likely to change, to get faster or to work on another system. E2E tests cover only complex modules that are likely to change. Never write smoke tests.

To check your work, run `pnpm verify`. It runs the test layers your diff can affect, and CI runs the rest. The `test-pixvitta` skill has the full procedure, including how to see the UI in a preview tab and drive the real app. `docs/testing.md` explains the design and which layer a new test belongs in.

- Never send a request to a real provider, from a test or while checking your work. Every test layer and `pnpm app` answer from `src/main/testing/fakeWeb.ts`; add routes there. Run `pnpm electron:dev` against real sites only when the user asks.
- Never use real user data. Sandboxes live under `.tmp/app` and `test-results`.
- Never kill a process found by name or pattern; other worktrees run their own apps. Use `pnpm app stop`, or the PID of a process you started.
- No sleeps or retries in tests. Wait on something the app does. A flaky test is a bug.
- Selectors belong in `tests/support/viewer.ts`, never in a spec.

## Worktrees and branches

Work that could become a PR (a feature, a fix, docs, a refactor, anything meant to be committed) happens in its own worktree, never in the main checkout. Questions, reviews, and read-only exploration can stay where they are.

Before you start any work, check which branch you are on (`git branch --show-current`, or `t3_worktree_status`). Do this every time, before your first edit.

- If the thread is not in a worktree, move it with `t3_worktree_handoff`: branch `<prefix>/<short-name>`, `baseRef: "dev"` with `startFromOrigin: true`, or `main` for a hotfix.
- If the branch does not follow the naming rule below, rename it with `git branch -m <prefix>/<short-name>` before you edit anything. T3 names new branches `t3/...`, both as an id (`t3/c2430f95`) and as a slug (`t3/fix-thumbnails`). Neither form is valid.
- Check that the branch starts from `dev` (or `main` for a hotfix). T3 can create new worktrees from `main`, which is behind `dev` and has an older copy of this file. Run `git fetch origin dev` and `git merge-base --is-ancestor origin/dev HEAD`. If it fails and the branch has no commits of its own yet, move it with `git reset --hard origin/dev`, then read this file again, because the `dev` copy may have rules this one lacks.

Branch names are one prefix plus a short kebab-case name, like `feat/saved-mixes`:

| Prefix | For |
| --- | --- |
| `feat/` | A new user-facing capability |
| `fix/` | A bug fix into dev |
| `hotfix/` | An urgent fix straight into main (`release:hotfix`) |
| `refactor/` | Restructuring that does not change behavior |
| `docs/` | Docs, plans, `AGENTS.md`, and skills |
| `test/` | Test-only changes |
| `ci/` | Workflows and release scripts |
| `chore/` | Dependencies, tooling, and housekeeping |
| `experiment/` | Spikes that are not meant to merge as they are |

## Commits and pull requests

- Commit messages and PR titles are plain imperative sentences with no prefix, like "Add an in-app update button to Settings".
- Never add a generated-by notice such as "Generated with Claude Code" anywhere: not in commits, PR descriptions, issues, comments, code, or docs. Never add a `Co-Authored-By` trailer for Claude or any other AI.
- Never push directly to `dev` or `main` unless the user clearly tells you to. "Commit this to dev" means open a PR into `dev`.
- One concern per PR. If the description needs an "also", split it.
- Before opening a PR, bring the branch up to date with its base (`dev`, or `main` for a hotfix) and run `pnpm verify`.
- PR body: the problem in a sentence or two, then how you fixed it.
- UI changes need before and after screenshots (`pnpm app screenshot`). Motion or timing needs a short recording of the stage in a preview tab.
- Every PR runs the Validate workflow (`pnpm validate`). Only merge PRs whose checks pass.

## Versioning

CI owns the version in `package.json` (`X.Y.Z`). Never change it by hand: not in a PR, not when merging, not to resolve a conflict. `docs/releasing.md` explains how CI bumps it.

- A PR straight into main must have the `release:hotfix` or `release:major` label before it merges. When opening a PR into main, ask the user which label applies.
- If the Stable workflow's "Merge the release back into dev" job fails on a conflict, merge main into dev by hand, resolve the listed files, and leave the version line as it is on dev.
- In code, read the version with `app.getVersion()` (main process) or `buildInfo.version` (renderer).
- The version rules live in `scripts/release-version.mjs`; change them there and keep its tests in sync.
