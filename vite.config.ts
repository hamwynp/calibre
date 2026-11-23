import { defineConfig } from "vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { execSync } from "node:child_process";
// @ts-expect-error type error without @types/node package
import { readFileSync } from "node:fs";
const host = process.env.TAURI_DEV_HOST;

// Build stamp shown in the in-app help (Ctrl+/), so every build can be told apart when testing.
function buildStamp(): string {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version as string;
  const sh = (cmd: string): string => {
    try {
      return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "";
    }
  };
  const hash = sh("git rev-parse --short HEAD") || "nogit";
  const dirty = sh("git status --porcelain") ? "+dirty" : "";
  const date = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `v${version} \u00b7 ${hash}${dirty} \u00b7 ${date}`;
}

// https://vite.dev/config/
export default defineConfig(() => ({
  define: { __BUILD__: JSON.stringify(buildStamp()) },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
