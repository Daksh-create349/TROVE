import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import esbuild from "esbuild";

function compilePreloadCommonJs() {
  try {
    esbuild.buildSync({
      entryPoints: ["electron/preload.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["electron"],
      outfile: "dist-electron/preload.cjs",
    });
    copyFileSync("dist-electron/preload.cjs", "dist-electron/preload.js");
  } catch (err) {
    console.error("Failed compiling preload CommonJS:", err);
  }
}

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    electron([
      {
        // Main process entry
        entry: "electron/main.ts",
      },
    ]),
    {
      name: "compile-preload-cjs",
      buildStart() {
        compilePreloadCommonJs();
      },
      closeBundle() {
        compilePreloadCommonJs();
      },
    },
    renderer(),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@shared": resolve(__dirname, "../shared"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
