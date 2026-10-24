import { appBuildInfo } from "../app/buildInfo";

// Request, cache, and download tracing is verbose. It is on for local dev
// builds and can be enabled elsewhere with PIXVITTA_DEBUG=1.
const isEnabled =
  appBuildInfo.flavor === "dev" || process.env.PIXVITTA_DEBUG === "1";

export function debugLog(scope: string, message: string): void {
  if (!isEnabled) return;
  console.debug(`[${scope} ${new Date().toISOString()}] ${message}`);
}
