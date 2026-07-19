import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

const host = process.env.TAURI_DEV_HOST;

// Force heavy, lazily-loaded vendor modules into their own chunks so they stay
// out of the initial bundle. Without this, Vite merges small dynamic-import
// targets into the main chunk (its default chunk-merging logic folds dynamic
// imports that share dependencies with the eager graph). The CodeMirror
// language packs are loaded on demand via loadLanguageSupport; highlight.js is
// eager today (sync chat-markdown API) but isolated here so the main app chunk
// stays small and the big syntax-highlighting payload caches independently.
/**
 * @param {string} id - The module id (resolved file path).
 * @returns {string | undefined}
 */
function manualChunks(id) {
  if (id.includes("node_modules")) {
    if (id.includes("@codemirror/lang-") || id.includes("@replit/codemirror-lang-")) {
      return "codemirror-languages";
    }
    if (id.includes("highlight.js")) {
      return "highlight-js";
    }
  }
  return undefined;
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [sveltekit()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1431,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    rollupOptions: {
      output: { manualChunks },
    },
  },
}));
