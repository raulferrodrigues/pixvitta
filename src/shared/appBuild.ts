export type BuildFlavor = "stable" | "dev";

export type AppBuildInfo = {
  flavor: BuildFlavor;
  name: "Pixvitta" | "Pixvitta Dev";
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
  if (flavorOverride === "stable" || flavorOverride === "dev") return flavorOverride;
  if (productName?.trim().toLowerCase() === "pixvitta dev") return "dev";
  return version.includes("-") ? "dev" : "stable";
}

export function createAppBuildInfo(options: ResolveBuildFlavorOptions): AppBuildInfo {
  const flavor = resolveBuildFlavor(options);
  return {
    flavor,
    name: flavor === "dev" ? "Pixvitta Dev" : "Pixvitta",
    version: options.version
  };
}
