import { app } from "electron";
import path from "node:path";
import { appBuildInfo } from "../app/buildInfo";

const iconFiles = {
  stable: "pixvitta-icon.png",
  nightly: "pixvitta-nightly-icon.png",
  dev: "pixvitta-dev-icon.png"
} as const;

export function getWindowIcon(): string | undefined {
  if (process.platform !== "linux") return undefined;

  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(__dirname, "..", "..", "assets", iconFiles[appBuildInfo.flavor]);
}
