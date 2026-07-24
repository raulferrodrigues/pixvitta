export type BuildFlavor = "stable" | "dev" | "nightly";

export type AppBuildInfo = {
  flavor: BuildFlavor;
  name: "Pixvitta" | "Pixvitta Dev" | "Pixvitta Nightly";
  version: string;
};

type ResolveBuildFlavorOptions = {
  flavorOverride?: string;
  productName?: string;
  version: string;
};

export function resolveBuildFlavor({
  flavorOverride,
  productName,
  version
}: ResolveBuildFlavorOptions): BuildFlavor {
  if (
    flavorOverride === "stable" ||
    flavorOverride === "dev" ||
    flavorOverride === "nightly"
  ) {
    return flavorOverride;
  }

  const normalizedProductName = productName?.trim().toLowerCase();
  if (normalizedProductName === "pixvitta nightly") return "nightly";
  if (normalizedProductName === "pixvitta dev") return "dev";
  if (version.includes("-nightly.")) return "nightly";
  return version.includes("-") ? "dev" : "stable";
}

export function createAppBuildInfo(options: ResolveBuildFlavorOptions): AppBuildInfo {
  const flavor = resolveBuildFlavor(options);
  return {
    flavor,
    name:
      flavor === "nightly"
        ? "Pixvitta Nightly"
        : flavor === "dev"
          ? "Pixvitta Dev"
          : "Pixvitta",
    version: options.version
  };
}
