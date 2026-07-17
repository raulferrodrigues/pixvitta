/*
 * Update handling is intentionally conservative right now. The menu has a
 * visible "Check for Updates" item, but unsigned local builds cannot provide a
 * reliable automatic-update experience on macOS, so the app explains that state
 * instead of pretending updates are configured.
 */

export function getUpdatesDisabledMessage(version: string): string {
  return [
    `Pixvitta ${version}`,
    "",
    "Automatic updates are not enabled for this build.",
    "Reliable macOS updates require Developer ID signing and Apple notarization.",
    "Install new unsigned builds manually until signed GitHub Releases are configured."
  ].join("\n");
}
