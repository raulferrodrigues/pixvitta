# AGENTS.md

Pixvitta is an Electron macOS and Linux image and video viewer.

Use `pnpm` for project commands.

Do not create tests for every little thing. Only create tests when something actually needs a test. Things that need tests are those that have a define spec, shape or well described functionality and that be liable to implemetation changes in the future to make them more perfomant or work on different systems. E2E tests should be highly focused on the complicated stuff that again hit modules that are complex and are liable to change in the future.

Do not create smoke tests.

# Verifying your work
Run `pnpm verify`. It picks the test layers your diff can affect, and CI runs the rest. The `test-pixvitta` skill has the full procedure, including how to see the UI in a preview tab and drive the real app. `docs/testing.md` explains the design and which layer a new test belongs in.

- Never send a request to a real provider from a test or while checking your work. Every test layer and `pnpm app` answer from `src/main/testing/fakeWeb.ts`; add routes there. Run `pnpm electron:dev` against real sites only when the user asks.
- Never use real user data. Sandboxes live under `.tmp/app` and `test-results`.
- Never kill a process found by name or pattern; other worktrees run their own apps. Use `pnpm app stop`, or the PID of a process you started.
- No sleeps or retries in tests. Wait on something the app does. A flaky test is a bug.
- Selectors belong in `tests/support/viewer.ts`, never in a spec.

When you see the user intends to start working on something that requires actual planning and several decisions and steps, ask the user if they want to create a planning file to keep tracking of decisions and details of the work.

Ask the user questions if there's good options for solutions. Things like tech choices, artifact shapes, etc. Do not ask user for implementation details unless the user asks you to ask them for implementation details.

# Pushing to dev and main
If the user doesn't explicit say that some new change should only be sent to dev, if they say "merge it and push it", assume they mean main. Merge first to dev, then merge dev into main.

After any merge or push to dev or main, pull before pushing again. CI pushes version commits to both branches.

# Versioning
CI owns the version in `package.json`, in `X.Y.Z` form, for every platform. Never change the version by hand, not in a PR, not when merging, not to "fix" a conflict. The README's Versioning section is the full reference; the rules are:
- A PR merging into dev (or any push to dev) bumps Z. The Nightly workflow commits the bump to dev, then builds that commit.
- dev merging into main bumps Y and resets Z (0.4.3 -> 0.5.0). The Stable workflow commits `Release vX.Y.Z` to main, builds it, then merges main back into dev.
- X is bumped only when the dev -> main PR has the `release:major` label.
- A hotfix is a PR straight into main with the `release:hotfix` label. It bumps Z on main (0.5.0 -> 0.5.1). Dev never moves backwards when the hotfix is merged back (0.5.3 becomes 0.5.4).
- A PR straight into main must have `release:hotfix` (or `release:major`). Version Check fails it without one, and the Stable workflow refuses to release it; add the label to the merged PR and re-run the workflow.
- Every PR runs the Validate workflow (`pnpm validate`). Only merge PRs whose checks pass.
- Labels must be on the PR before it merges. Ask the user which label applies when opening a PR into main.
- The Version Check workflow fails PRs that change the version, and CI discards such edits anyway.
- If the Stable workflow's "Merge the release back into dev" job fails on a conflict, merge main into dev by hand, resolve the listed files, and leave the version line as it is on dev.
- In code, read the version with `app.getVersion()` (main process) or `buildInfo.version` (renderer).
- The version rules live in `scripts/release-version.mjs`; change them there and keep its tests in sync.

# Special rules

When doing work with web requests of any kind, check if there are rules to how many requests can be made and how fast they can be made. Always respect those limits.

Never add _ before variables.

Never add "Generated with Claude Code" (or any similar generated-by notice) anywhere, ever: not in commits, PR descriptions, issues, comments, code, or docs. Never add a `Co-Authored-By: Claude` (or any AI co-author) trailer to commits either.
