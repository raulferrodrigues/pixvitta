import { app, dialog, net } from "electron";
import { createRequestBroker } from "./scheduler";

let haltDialogShown = false;

function showHaltDialog(): void {
  if (haltDialogShown) return;
  haltDialogShown = true;
  void dialog
    .showMessageBox({
      type: "error",
      title: "Request limit reached",
      message:
        "Pixvitta was rate-limited by a media provider and must quit to stop further requests.",
      buttons: ["Quit Pixvitta"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    .then(
      () => app.quit(),
      (error: unknown) => {
        console.error("Could not show the request-limit dialog.", error);
        app.quit();
      }
    );
}


export const broker = createRequestBroker({
  fetch: (request) => net.fetch(request),
  onRateLimit: showHaltDialog,
  debug: (message) => console.debug(`[request-broker ${new Date().toISOString()}] ${message}`)
});
