import { createHash } from "node:crypto";

const FIRST_PORT = 5300;
const PORT_RANGE = 1000;

// Each checkout gets its own stable port, so parallel worktrees never fight over
// one and a preview tab stays valid across restarts.
export function stagePort(directory = process.cwd()) {
  const override = Number(process.env.PIXVITTA_STAGE_PORT);
  if (Number.isInteger(override) && override > 0) return override;
  const hash = createHash("sha256").update(directory).digest().readUInt32BE(0);
  return FIRST_PORT + (hash % PORT_RANGE);
}
