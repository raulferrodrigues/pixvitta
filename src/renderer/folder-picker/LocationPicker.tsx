import { Globe2 } from "lucide-react";
import { useGT } from "gt-react";
import { useState, type FormEvent } from "react";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { PrimaryButton } from "../ui/PrimaryButton";
import { SourceOpenError } from "./SourceOpenError";

export function LocationPicker({
  showHeading = true
}: {
  showHeading?: boolean;
}) {
  const gt = useGT();
  const [location, setLocation] = useState("");
  const openLocation = useViewerStore((state) => state.openLocation);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = location.trim();
    if (value) void openLocation(value);
  }

  return (
    <form className="grid gap-2.5" onSubmit={submit}>
      <label
        className={showHeading ? "text-xs font-bold uppercase text-pix-section" : "sr-only"}
        htmlFor="source-location"
      >
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
      <SourceOpenError />
    </form>
  );
}
