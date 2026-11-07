import type { Plugin } from "vite";
import { defineConfig, mergeConfig } from "vite";
import { stagePort } from "./scripts/stage-port.mjs";
import baseConfig from "./vite.config.mts";

// Serves the renderer at /stage.html against a fake window.pixvitta, for driving
// the UI in a browser tab without Electron. See docs/testing.md.

function labelledImage(width: number, height: number, label: string): string {
  const hue = [...label].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="hsl(${hue} 45% 35%)"/><text x="50%" y="50%" fill="white" font-family="sans-serif" font-size="${Math.round(height / 10)}" text-anchor="middle">${label}</text></svg>`;
}

// /stage-media/1200x800/name.svg  a labelled image of that size
// /stage-media/missing/name.svg   always 404
// /stage-media/flaky/name.svg     404 until the renderer's retry URL arrives
function stageMedia(): Plugin {
  return {
    name: "pixvitta-stage-media",
    configureServer(server) {
      server.middlewares.use("/stage-media", (request, response) => {
        const url = new URL(request.url ?? "/", "http://stage");
        const [, kind, file = "media"] = url.pathname.split("/");
        const name = decodeURIComponent(file).replace(/\.svg$/, "");
        const size = /^(\d+)x(\d+)$/.exec(kind);
        const recovered = kind === "flaky" && url.searchParams.has("attempt");
        if (!size && !recovered) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader("Content-Type", "image/svg+xml");
        response.end(labelledImage(Number(size?.[1] ?? 640), Number(size?.[2] ?? 480), name));
      });
    }
  };
}

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [stageMedia()],
    optimizeDeps: { entries: ["stage.html"] },
    server: { host: "127.0.0.1", port: stagePort(), strictPort: true, forwardConsole: false }
  })
);
