import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// The Node test bundle uses a temporary userData directory and refuses live
// networking. Provider tests exercise the real broker and disk cache.
const userData = mkdtempSync(path.join(os.tmpdir(), "pixvitta-tests-"));
process.once("exit", () => rmSync(userData, { recursive: true, force: true }));

export const app = {
  whenReady: async () => {},
  getPath(name: string) {
    if (name !== "userData") throw new Error(`Unexpected app path in test: ${name}`);
    return userData;
  },
  quit() { throw new Error("Unexpected quit in test."); }
};

export const net = {
  async fetch(): Promise<Response> { throw new Error("Live networking is disabled in tests."); }
};

export const dialog = {
  async showMessageBox(): Promise<never> { throw new Error("Unexpected dialog in test."); }
};

// The thumbnailer runtime is bundled because of its guarded dynamic import, but
// it only starts inside Electron. These names satisfy the bundle and stay unused.
export const ipcMain = {};
export const nativeImage = {};
export const protocol = {};
