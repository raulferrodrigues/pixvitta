import { AlertCircle } from "lucide-react";
import { useGT } from "gt-react";
import type { OpenSourceError } from "../../shared/media";
import { useViewerStore } from "../state/ViewerStoreProvider";

function errorMessage(
  error: OpenSourceError,
  gt: ReturnType<typeof useGT>
): string {
  if (error === "invalid-location") return gt("Enter a complete supported location.");
  if (error === "unsupported-location") return gt("No installed provider supports that location.");
  if (error === "not-found") return gt("That source could not be found.");
  if (error === "rate-limited") return gt("The provider asked Pixvitta to slow down. Try again shortly.");
  if (error === "invalid-response") return gt("The provider returned an unexpected response.");
  if (error === "no-supported-media") return gt("That source has no supported images or videos.");
  return gt("Could not reach the provider. Check your connection and try again.");
}

export function SourceOpenError({
  presentation = "inline"
}: {
  presentation?: "inline" | "toast";
}) {
  const gt = useGT();
  const sourceOpenError = useViewerStore((state) => state.sourceOpenError);
  if (!sourceOpenError) return null;

  if (presentation === "toast") {
    return (
      <div
        className="fixed left-1/2 top-[calc(var(--pix-topbar-height)+12px)] z-50 flex max-w-[min(560px,calc(100vw-32px))] -translate-x-1/2 items-start gap-2.5 rounded-lg border border-red-400/35 bg-red-950/95 px-4 py-3 text-sm text-red-100 shadow-xl"
        role="alert"
        data-testid="source-open-error"
      >
        <AlertCircle className="mt-0.5 shrink-0" size={17} aria-hidden />
        <span>{errorMessage(sourceOpenError, gt)}</span>
      </div>
    );
  }

  return (
    <p className="m-0 text-sm text-red-300" role="alert">
      {errorMessage(sourceOpenError, gt)}
    </p>
  );
}
