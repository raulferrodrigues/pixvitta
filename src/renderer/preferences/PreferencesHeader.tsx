import { useGT } from "gt-react";
import type { AppBuildInfo } from "../../shared/appBuild";
import { DevBuildBadge } from "../ui/DevBuildBadge";

export type PreferencesSaveState = "idle" | "saving" | "saved" | "error";

export function PreferencesHeader({
  saveState,
  buildInfo
}: {
  saveState: PreferencesSaveState;
  buildInfo: AppBuildInfo;
}) {
  const gt = useGT();
  const label = saveState === "saving" ? gt("Saving") : saveState === "error" ? gt("Error") : gt("Saved");

  return (
    <header className="mb-5 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <h1 className="m-0 text-[22px] leading-tight">{gt("Settings")}</h1>
        <DevBuildBadge buildInfo={buildInfo} />
      </div>
      <span className="text-xs font-semibold uppercase text-pix-preferences-muted" data-testid="settings-save-state">
        {label}
      </span>
    </header>
  );
}
