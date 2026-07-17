import { app } from "electron";
import { showAppMessageBox } from "../windows";
import { getUpdatesDisabledMessage } from "./updateStatus";

/*
 * The app exposes a "Check for Updates" menu item now, but local builds are not
 * signed/notarized yet. Until real update infrastructure is configured, the
 * native menu action shows a clear explanation rather than silently doing
 * nothing.
 */

export async function showUpdatesDisabledDialog(): Promise<void> {
  const detail = getUpdatesDisabledMessage(app.getVersion());
  if (process.env.PIXVITTA_TEST_UPDATE_DIALOG === "record") {
    (globalThis as typeof globalThis & { __pixvittaLastUpdateDialog?: string }).__pixvittaLastUpdateDialog = detail;
    return;
  }

  const options: Electron.MessageBoxOptions = {
    type: "info",
    title: "Updates",
    message: "Automatic updates require signed releases",
    detail,
    buttons: ["OK"],
    defaultId: 0,
    cancelId: 0
  };

  await showAppMessageBox(options);
}
