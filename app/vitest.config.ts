import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";

export default defineConfig({
  plugins: [sveltekit()],
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
