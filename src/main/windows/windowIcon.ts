import { app } from "electron";
import path from "node:path";
import { appBuildInfo } from "../app/buildInfo";

export function getWindowIcon(): string | undefined {
  if (process.platform !== "linux") return undefined;

  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(
      __dirname,
      "..",
      "..",
      "assets",
      appBuildInfo.flavor === "stable"
        ? "pixvitta-icon.png"
        : "pixvitta-dev-icon.png"
    );
}
