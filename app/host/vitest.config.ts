import { defineConfig } from "vitest/config";

/**
 * Host test config — separate from the SvelteKit app config. Unit tests for
 * protocol/framing/dispatch/redaction run in-process; `src/process.test.ts`
 * spawns the built host over a real stdio channel (built first via
 * `scripts/build.mjs`).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
