import { useGT } from "gt-react";
import type { AppBuildInfo } from "../../../shared/appBuild";
import { ControlGroup } from "../../parts/controls/ControlGroup";
import { DownloadCollectionButton, DownloadMediaButton } from "../../parts/controls/DownloadButtons";
import { OpenFolderButton, RefreshButton } from "../../parts/controls/SourceActions";
import { Counter, SourceOrigin } from "../../parts/controls/SourceInfo";
import { DownloadPanelToggle, FilmstripToggle, FullscreenButton, UnobtrusiveToggle, ViewModeToggle } from "../../parts/controls/ViewButtons";
import { WebSourceDialog } from "../../parts/controls/WebSourceDialog";
import { SettingsToggle } from "../../parts/settings/SettingsModal";
import { BuildFlavorBadge } from "../../ui/BuildFlavorBadge";
import { ClassicControls } from "./ClassicControls";

// The left side holds the source and the actions on it, the middle the
// transport, and the right side how the media is viewed, with Settings at the
// edge. Each panel toggle sits on the side of its panel. The sides start as
// wide as the filmstrip and download panel columns and grow evenly, so the
// transport is centered over the media and gets pushed aside, rather than
// covered, when a side runs out of room.
export function ClassicTopBar({ buildInfo }: { buildInfo: AppBuildInfo }) {
  const gt = useGT();
  return (
    <header className="topbar" data-testid="title-bar" aria-label="Window title">
      <div className="topbar-start">
        <div className="topbar-traffic-space" aria-hidden />
        <FilmstripToggle />
        <BuildFlavorBadge buildInfo={buildInfo} />
        <SourceOrigin />
        <span className="topbar-divider" aria-hidden />
        <ControlGroup label={gt("Library controls")} className="topbar-group">
          <OpenFolderButton />
          <WebSourceDialog />
          <RefreshButton />
          <DownloadMediaButton />
          <DownloadCollectionButton />
        </ControlGroup>
      </div>
      <ClassicControls />
      <div className="topbar-end">
        <Counter />
        <span className="topbar-divider" aria-hidden />
        <ControlGroup label={gt("Viewing options")} className="topbar-group">
          <ViewModeToggle />
          <FullscreenButton />
          <UnobtrusiveToggle />
          <DownloadPanelToggle />
        </ControlGroup>
        <span className="topbar-divider" aria-hidden />
        <ControlGroup label={gt("App controls")} className="topbar-group topbar-group-end">
          <SettingsToggle />
        </ControlGroup>
      </div>
    </header>
  );
}
