import { CornerDownLeft, FolderPlus, Link2, LoaderCircle } from "lucide-react";
import { useGT } from "gt-react";
import { useState, type FormEvent } from "react";
import { SourceOpenError } from "../../folder-picker/SourceOpenError";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { SourceNotice } from "./SourceNotice";

// One field adds a source by its web address or folder path; Enter submits.
// The folder button at its end picks a folder instead. A failed add shows its
// error, or main's note that the source is already in the mix, right below.
export function AddSourceField() {
  const gt = useGT();
  const [location, setLocation] = useState("");
  // The location this field submitted, until main answers that add. Main
  // answers every add, so the wait always ends, and only this field's own
  // answer can empty it: an add made elsewhere never touches what is typed.
  const [pendingLocation, setPendingLocation] = useState<string | null>(null);
  const addLocation = useViewerStore((state) => state.addLocation);
  const addFolder = useViewerStore((state) => state.addFolder);
  const isSourceLoading = useViewerStore((state) => state.isSourceLoading);
  const dismissSourceNotice = useViewerStore((state) => state.dismissSourceNotice);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = location.trim();
    if (!value || isSourceLoading || pendingLocation !== null) return;
    setPendingLocation(value);
    try {
      const result = await addLocation(value);
      // Added, or already there: either way the source is in the mix. A
      // failure keeps the text so it can be corrected.
      if (result !== "not-added") {
        setLocation((current) => (current.trim() === value ? "" : current));
      }
    } finally {
      setPendingLocation(null);
    }
  }

  const supported = gt("Supports folder paths, and 4chan thread, E-Hentai, ExHentai, and nhentai gallery URLs.");
  const isAdding = pendingLocation !== null;
  const LeadingIcon = isAdding ? LoaderCircle : Link2;

  return (
    <form className="sources-add" onSubmit={(event) => void submit(event)} data-testid="add-source-form">
      <div className="sources-add-field" data-busy={isSourceLoading || undefined}>
        <LeadingIcon className={isAdding ? "sources-add-leading animate-spin" : "sources-add-leading"} size={14} aria-hidden />
        <label className="sr-only" htmlFor="add-source-location">{gt("Add a source")}</label>
        <input
          id="add-source-location"
          className="sources-add-input"
          type="text"
          value={location}
          placeholder={gt("Paste a URL or path")}
          title={supported}
          aria-describedby="add-source-supported"
          autoComplete="off"
          spellCheck={false}
          // Read-only rather than disabled while loading, so the field keeps
          // focus and a failed add can be corrected straight away.
          readOnly={isSourceLoading}
          onChange={(event) => {
            setLocation(event.target.value);
            dismissSourceNotice();
          }}
        />
        <span id="add-source-supported" className="sr-only">{supported}</span>
        {location.trim() ? (
          <button
            type="submit"
            className="sources-add-button"
            title={gt("Add (Enter)")}
            aria-label={gt("Add")}
            disabled={isSourceLoading}
            data-testid="add-location"
          >
            <CornerDownLeft size={14} aria-hidden />
          </button>
        ) : null}
        <span className="sources-add-divider" aria-hidden />
        <button
          type="button"
          className="sources-add-button"
          title={gt("Add a folder…")}
          aria-label={gt("Add a folder")}
          disabled={isSourceLoading}
          data-testid="add-folder"
          onClick={() => void addFolder()}
        >
          <FolderPlus size={15} aria-hidden />
        </button>
      </div>
      <SourceOpenError presentation="compact" />
      <SourceNotice presentation="compact" />
    </form>
  );
}
