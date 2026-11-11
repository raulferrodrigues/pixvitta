import { AlertCircle } from "lucide-react";
import { useGT } from "gt-react";
import type { OpenSourceError } from "../../shared/media";
import { useViewerStore } from "../state/ViewerStoreProvider";

export function errorMessage(
  error: OpenSourceError,
  gt: ReturnType<typeof useGT>
): string {
  if (error === "invalid-location") return gt("Enter a complete supported location.");
  if (error === "unsupported-location") return gt("No installed provider supports that location.");
  if (error === "not-found") return gt("That source could not be found.");
  if (error === "authentication-required") return gt("Sign in to the E-Hentai forums to open ExHentai galleries. Close the sign-in window when finished.");
  if (error === "rate-limited") return gt("The provider asked Pixvitta to slow down. Try again shortly.");
  if (error === "invalid-response") return gt("The provider returned an unexpected response.");
  if (error === "no-supported-media") return gt("That source has no supported images or videos.");
  return gt("Could not reach the provider. Check your connection and try again.");
}

export function SourceOpenError({
  presentation = "inline"
}: {
  // "compact" sits under the sources panel's narrow add field.
  presentation?: "inline" | "toast" | "compact";
}) {
  const gt = useGT();
  const sourceOpenError = useViewerStore((state) => state.sourceOpenError);
  const signInExHentai = useViewerStore((state) => state.signInExHentai);
  if (!sourceOpenError) return null;

  const signInButton = sourceOpenError === "authentication-required" ? (
    <button
      type="button"
      className="shrink-0 rounded-md border border-current px-2 py-1 text-xs font-semibold"
      onClick={() => void signInExHentai()}
    >
      {gt("Sign in")}
    </button>
  ) : null;

  if (presentation === "toast") {
    return (
      <div
        className="fixed left-1/2 top-[calc(var(--pix-topbar-height)+12px)] z-50 flex max-w-[min(560px,calc(100vw-32px))] -translate-x-1/2 items-start gap-2.5 rounded-lg border border-red-400/35 bg-red-950/95 px-4 py-3 text-sm text-red-100 shadow-xl"
        role="alert"
        data-testid="source-open-error"
      >
        <AlertCircle className="mt-0.5 shrink-0" size={17} aria-hidden />
        <span>{errorMessage(sourceOpenError, gt)}</span>
        {signInButton}
      </div>
    );
  }

  if (presentation === "compact") {
    return (
      <div className="flex items-start gap-1.5 text-[11px] leading-[1.4] text-red-300" role="alert" data-testid="source-open-error">
        <AlertCircle className="mt-px shrink-0" size={13} aria-hidden />
        <span className="min-w-0 flex-1">{errorMessage(sourceOpenError, gt)}</span>
        {signInButton}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-red-300" role="alert">
      <span>{errorMessage(sourceOpenError, gt)}</span>
      {signInButton}
    </div>
  );
}
