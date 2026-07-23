import { app } from "electron";
import path from "node:path";
import { createAppBuildInfo } from "../../shared/appBuild";

export const appBuildInfo = createAppBuildInfo({
  flavorOverride: process.env.PIXVITTA_BUILD_FLAVOR,
  productName: app.name,
  version: app.getVersion()
});

export function configureAppIdentity(): void {
  app.setName(appBuildInfo.name);

  if (process.env.PIXVITTA_TEST_USER_DATA_DIR) {
    app.setPath("userData", process.env.PIXVITTA_TEST_USER_DATA_DIR);
    return;
  }

  if (appBuildInfo.flavor === "dev") {
    app.setPath("userData", path.join(app.getPath("appData"), "Pixvitta Dev"));
  }
}
