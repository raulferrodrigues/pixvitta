import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    entries: ["index.html"]
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
