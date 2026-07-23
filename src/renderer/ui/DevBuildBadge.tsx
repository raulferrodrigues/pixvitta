import type { AppBuildInfo } from "../../shared/appBuild";

export function DevBuildBadge({ buildInfo }: { buildInfo: AppBuildInfo }) {
  if (buildInfo.flavor !== "dev") return null;

  const label = `Development build ${buildInfo.version}`;
  return (
    <span
      className="inline-flex h-5 items-center rounded-full bg-pix-dev px-2 text-[10px] font-bold tracking-[0.12em] text-pix-dev-text"
      title={label}
      aria-label={label}
      data-testid="dev-build-badge"
    >
      DEV
    </span>
  );
}
