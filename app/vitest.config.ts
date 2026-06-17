import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";

export default defineConfig({
  plugins: [sveltekit()],
  // Force the `browser` export condition so Svelte 5 resolves to its client
  // entry (`index-client.js`, which exports `mount` / `unmount`) instead of the
  // server entry (`index-server.js`, which throws on `mount`). Vitest's jsdom
  // environment runs the server conditions by default; component tests that
  // mount Svelte components need the client build.
  resolve: {
    conditions: ["browser"],
  },
  test: {
    // DOM environment is required by the chat markdown sanitizer (DOMPurify)
    // and other components that touch `document`/`window`. jsdom is used
    // because DOMPurify's mXSS detection relies on prototype-chain property
    // descriptors that happy-dom does not expose correctly.
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{js,ts}"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
