/**
 * Agent Host CLI entry (phase D, task AS01-D-01).
 *
 * Bundled by `scripts/build.mjs` into a single ESM file (the `#!/usr/bin/env
 * node` banner is injected at build). Started from the packaged path; supervised
 * by Tauri in phase E. Run with `node dist/index.js`.
 */

import { createHost } from "./host";

const host = createHost();

host
  .run()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    // Redact and print to stderr; never echo raw error text that may carry secrets.
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`agent-host fatal: ${message}\n`);
    process.exit(1);
  });
