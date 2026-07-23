import { Globe2 } from "lucide-react";
import { useGT } from "gt-react";
import { useState, type FormEvent } from "react";
import type { OpenSourceError } from "../../shared/media";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { PrimaryButton } from "../ui/PrimaryButton";

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

export function LocationPicker() {
  const gt = useGT();
  const [location, setLocation] = useState("");
  const openLocation = useViewerStore((state) => state.openLocation);
  const sourceOpenError = useViewerStore((state) => state.sourceOpenError);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = location.trim();
    if (value) void openLocation(value);
  }

  return (
    <form className="grid gap-2.5" onSubmit={submit}>
      <label className="text-xs font-bold uppercase text-pix-section" htmlFor="source-location">
        {gt("Open from the web")}
      </label>
      <div className="flex gap-2.5 max-[560px]:flex-col">
        <input
          id="source-location"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-pix-control-border bg-pix-recent px-3 text-sm text-pix-recent-text outline-none placeholder:text-pix-recent-path focus:border-pix-accent focus:ring-1 focus:ring-pix-accent"
          type="url"
          value={location}
          placeholder={gt("Paste a supported URL")}
          autoComplete="off"
          spellCheck={false}
          required
          onChange={(event) => setLocation(event.target.value)}
        />
        <PrimaryButton type="submit" className="shrink-0">
          <Globe2 size={18} aria-hidden />
          <span>{gt("Open source")}</span>
        </PrimaryButton>
      </div>
      <p className="m-0 min-h-5 text-xs text-pix-recent-path">
        {gt("Experimental providers currently support 4chan thread URLs.")}
      </p>
      {sourceOpenError ? (
        <p className="m-0 text-sm text-red-300" role="alert">
          {errorMessage(sourceOpenError, gt)}
        </p>
      ) : null}
    </form>
  );
}
