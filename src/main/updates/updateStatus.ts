import type { BuildFlavor } from "../../shared/appBuild";
import type { UpdateChannel, UpdateUnavailableReason } from "../../shared/updates";

export type LinuxUpdatePackageType = "appimage" | "deb";

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

export function getUpdateChannel(flavor: BuildFlavor): UpdateChannel {
  return flavor === "nightly" ? "nightly" : "latest";
}

/** Why this build cannot update itself, or null when it can. */
export function getUpdatesUnavailableReason(support: UpdateSupport): UpdateUnavailableReason | null {
  if (!support.isPackaged) return "unpackaged";
  // macOS installs updates only into signed apps, and releases are not signed yet.
  if (support.platform !== "linux") return "unsigned-macos";
  if (!getLinuxUpdatePackageType(support)) return "unsupported-linux-package";
  return null;
}
