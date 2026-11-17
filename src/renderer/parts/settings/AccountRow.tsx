import { useGT } from "gt-react";
import type { AccountState, AccountStatus } from "../../../shared/accounts";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { classNames } from "../../ui/classNames";

type Translate = ReturnType<typeof useGT>;

const STATUS_STYLES: Record<AccountStatus, { dot: string; badge: string }> = {
  "signed-in": { dot: "bg-emerald-400", badge: "bg-emerald-400/12 text-emerald-300" },
  "signing-in": { dot: "bg-amber-400 animate-pulse", badge: "bg-amber-400/12 text-amber-300" },
  "signed-out": { dot: "bg-pix-muted/50", badge: "bg-pix-control-muted text-pix-muted" }
};

// One row per provider account, after T3 Code's provider rows: a status dot,
// the name with a status badge, what the account is for, and the next step.
// Main pushes every status change.
export function AccountRow({ account }: { account: AccountState }) {
  const gt = useGT();
  const signIn = useViewerStore((state) => state.signIn);
  const signOut = useViewerStore((state) => state.signOut);
  const styles = STATUS_STYLES[account.status];
  const descriptionId = `account-${account.id}-description`;
  const isSignedIn = account.status === "signed-in";

  return (
    <div
      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3"
      data-testid={`account-row-${account.id}`}
      data-status={account.status}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={classNames("size-2 shrink-0 rounded-full", styles.dot)} aria-hidden />
          <span className="truncate text-sm font-medium text-pix-text">{account.label}</span>
          <span className={classNames("shrink-0 rounded-full px-2 py-px text-[11px] font-medium", styles.badge)}>
            {statusLabel(gt, account.status)}
          </span>
        </div>
        <p id={descriptionId} className="m-0 pl-4 text-[13px] leading-[1.45] text-pix-muted">
          {account.status === "signing-in"
            ? gt("Finish in the sign-in window, then close it.")
            : account.description}
        </p>
      </div>
      <button
        type="button"
        className={classNames(
          "inline-flex h-7 cursor-pointer items-center rounded-md border px-2.5 text-xs font-medium [font:inherit] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pix-accent",
          isSignedIn
            ? "border-transparent bg-transparent text-pix-muted hover:bg-pix-panel-hover hover:text-pix-text"
            : "border-pix-accent/60 bg-pix-accent/15 text-pix-text hover:bg-pix-accent/25"
        )}
        aria-describedby={descriptionId}
        data-testid={`account-button-${account.id}`}
        onClick={() => void (isSignedIn ? signOut(account.id) : signIn(account.id))}
      >
        {buttonLabel(gt, account.status)}
      </button>
    </div>
  );
}

function statusLabel(gt: Translate, status: AccountStatus): string {
  if (status === "signed-in") return gt("Signed in");
  if (status === "signing-in") return gt("Signing in");
  return gt("Not signed in");
}

function buttonLabel(gt: Translate, status: AccountStatus): string {
  if (status === "signed-in") return gt("Sign out");
  // Signing in again focuses the window that is already open.
  if (status === "signing-in") return gt("Show window");
  return gt("Sign in");
}
