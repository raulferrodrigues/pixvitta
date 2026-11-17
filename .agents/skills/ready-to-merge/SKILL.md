---
name: ready-to-merge
description: open PR, create PR, push, ready to merge, merge when ready, you can merge, review and fix, ship it.
---

# Ready to merge

Run this once the work is done, before you open the PR.

## 1. Commit

Commit the work, bring the branch up to date with its base (`origin/dev`, or `origin/main` for a hotfix), and run `pnpm verify`.

## 2. Two rounds of review and fix

Do exactly two rounds. In each one:

1. Start a reviewer with `delegate_task`. Call `orchestrator_capabilities` first if you have not yet in this thread.
   - `role: "review"`
   - `target: { providerInstanceId: "claudeAgent", model: "claude-opus-5-5", options: { effort: "high" } }`
   - A `task` that stands on its own: the branch, its base, what the change is for, and to read `AGENTS.md` and review `git diff <base>...HEAD` for bugs and broken rules. It reports findings, most severe first, and changes no files.
2. End your turn. The reviewer's result wakes you.
3. Fix each real finding and commit. If a finding is wrong, skip it and note why.

The second round is a new `delegate_task`, never a message to the first reviewer.

## 3. Open the PR

Run `pnpm verify` again, push, and open the PR as `AGENTS.md` describes. Link it to the thread with `link_pull_request`.

## 4. Merge or wait

Merge only if the user said so in this thread, such as "merge when ready" or "you can merge it". Anything less is not permission.

- **Permission given**: call `watch_pull_request` and end your turn. Once the checks pass and nothing conflicts, merge with `gh pr merge <number> --merge`.
- **No permission**: call `watch_pull_request` and end your turn. Never merge.

Either way, when a check fails, fix it and push.
