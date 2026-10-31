import type { AppBuildInfo } from "../../shared/appBuild";

export function BuildFlavorBadge({ buildInfo }: { buildInfo: AppBuildInfo }) {
  if (buildInfo.flavor === "stable") return null;

  const isNightly = buildInfo.flavor === "nightly";
  const flavorLabel = isNightly ? "Nightly" : "Development";
  const label = `${flavorLabel} build ${buildInfo.version}`;
  return (
    <span
      className="inline-flex h-5 items-center rounded-full bg-pix-dev px-2 text-[10px] font-bold tracking-[0.12em] text-pix-dev-text"
      title={label}
      aria-label={label}
      data-testid={`${buildInfo.flavor}-build-badge`}
    >
      {isNightly ? "NIGHTLY" : "DEV"}
    </span>
  );
}
