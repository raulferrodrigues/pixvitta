import type { AppBuildInfo } from "../../../shared/appBuild";
import { Counter, SourceOrigin } from "../../parts/controls/SourceInfo";
import { DownloadPanelToggle, FilmstripToggle, ViewModeToggle } from "../../parts/controls/ViewButtons";
import { ShortcutsToggle } from "../../parts/shortcuts/ShortcutsSheet";
import { BuildFlavorBadge } from "../../ui/BuildFlavorBadge";

export function ClassicTopBar({ buildInfo }: { buildInfo: AppBuildInfo }) {
  return (
    <header className="topbar" data-testid="title-bar" aria-label="Window title">
      <div className="topbar-traffic-space" aria-hidden />
      <FilmstripToggle />
      <BuildFlavorBadge buildInfo={buildInfo} />
      <SourceOrigin />
      <div className="topbar-fill" aria-hidden />
      <Counter />
      <ShortcutsToggle />
      <ViewModeToggle />
      <DownloadPanelToggle />
    </header>
  );
}
