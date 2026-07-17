import { app } from "electron";
import path from "node:path";

export function getWindowIcon(): string | undefined {
  if (process.platform !== "linux") return undefined;

  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(__dirname, "..", "..", "build", "icon.png");
}
