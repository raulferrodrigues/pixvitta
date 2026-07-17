import { useGT } from "gt-react";

export type PreferencesSaveState = "idle" | "saving" | "saved" | "error";

export function PreferencesHeader({ saveState }: { saveState: PreferencesSaveState }) {
  const gt = useGT();
  const label = saveState === "saving" ? gt("Saving") : saveState === "error" ? gt("Error") : gt("Saved");

  return (
    <header className="mb-5 flex items-center justify-between">
      <h1 className="m-0 text-[22px] leading-tight">{gt("Settings")}</h1>
      <span className="text-xs font-semibold uppercase text-pix-preferences-muted" data-testid="settings-save-state">
        {label}
      </span>
    </header>
  );
}
