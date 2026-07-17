/*
 * Public updates surface. The implementation currently explains why automatic
 * updates are unavailable; future update machinery should stay behind this
 * boundary unless another module needs a new app-level update command.
 */
export { showUpdatesDisabledDialog } from "./updateDialog";
