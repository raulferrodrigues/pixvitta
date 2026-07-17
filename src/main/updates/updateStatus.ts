export type UpdateSupport = {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  appImagePath?: string;
};

export function getUpdatesUnavailableMessage(version: string, support: UpdateSupport): string {
  const heading = `Pixvitta ${version}`;

  if (!support.isPackaged) {
    return [heading, "", "Automatic updates are only available in packaged builds."].join("\n");
  }

  if (support.platform !== "linux") {
    return [
      heading,
      "",
      "Automatic updates are currently available only for the Linux AppImage build.",
      "macOS updates will remain disabled until releases are signed and notarized."
    ].join("\n");
  }

  if (!support.appImagePath) {
    return [
      heading,
      "",
      "This Linux build is not running from an AppImage.",
      "Install and launch Pixvitta.AppImage to receive automatic updates."
    ].join("\n");
  }

  return "";
}
