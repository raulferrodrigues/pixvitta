/*
 * Native dialogs are awkward in automated tests because they need a real user
 * click. This helper lets tests provide deterministic folder-picker responses
 * through an environment variable while production keeps using dialog.showOpenDialog.
 */

export function parseDialogResponses(): Array<string | null> | null {
  const value = process.env.PIXVITTA_TEST_DIALOG_RESPONSES;
  if (!value) return null;

  // E2E tests feed deterministic folder choices through the environment. null is
  // treated like the user canceled the dialog.
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("PIXVITTA_TEST_DIALOG_RESPONSES must be a JSON array");
  }

  return parsed.map((entry) => {
    if (entry === null || typeof entry === "string") return entry;
    throw new Error("PIXVITTA_TEST_DIALOG_RESPONSES entries must be strings or null");
  });
}
