export type LinuxUpdatePackageType = "appimage" | "deb";
export type UpdateChannel = "latest" | "dev";

export type UpdateSupport = {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  appImagePath?: string;
  packageTypeMarker?: string;
};

export function getLinuxUpdatePackageType(support: UpdateSupport): LinuxUpdatePackageType | undefined {
  if (support.platform !== "linux") return undefined;
  if (support.appImagePath) return "appimage";
  if (support.packageTypeMarker?.trim().toLowerCase() === "deb") return "deb";
  return undefined;
}

export function getUpdateChannel(version: string): UpdateChannel {
  return version.includes("-") ? "dev" : "latest";
}

export function getUpdatesUnavailableMessage(version: string, support: UpdateSupport): string {
  const heading = `Pixvitta ${version}`;

  if (!support.isPackaged) {
    return [heading, "", "Automatic updates are only available in packaged builds."].join("\n");
  }

  if (support.platform !== "linux") {
    return [
      heading,
      "",
      "Automatic updates are currently available only for Linux AppImage and Debian package builds.",
      "macOS updates will remain disabled until releases are signed and notarized."
    ].join("\n");
  }

  if (!getLinuxUpdatePackageType(support)) {
    return [
      heading,
      "",
      "This Linux package format does not support automatic updates.",
      "Install the Pixvitta AppImage or Debian package to receive automatic updates."
    ].join("\n");
  }

  return "";
}
