import { execFileSync } from "node:child_process";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function firstResolvableRef(refs) {
  for (const ref of refs) {
    try {
      git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
      return ref;
    } catch {
      // Not every checkout has every ref; try the next one.
    }
  }
  throw new Error(`Could not find a base branch to compare with (tried ${refs.join(", ")}).`);
}

function lines(output) {
  return output ? output.split("\n").filter(Boolean) : [];
}

// Everything that differs from where this branch left its base: commits on the
// branch, staged and unstaged edits, and new files. Feature branches start from
// dev, which is also where their pull requests go.
export function changedFiles(base) {
  const baseRef = base ?? firstResolvableRef(["origin/dev", "dev", "origin/main", "main"]);
  const mergeBase = git("merge-base", baseRef, "HEAD");
  return [
    ...new Set([
      ...lines(git("diff", "--name-only", mergeBase)),
      ...lines(git("ls-files", "--others", "--exclude-standard"))
    ])
  ];
}

// These can change the behavior of any test, and no import graph shows it.
export function isGlobalChange(file) {
  return (
    file === "package.json" ||
    file === "pnpm-lock.yaml" ||
    file === "scripts/run-tests.mjs" ||
    file === "scripts/changed-files.mjs"
  );
}
