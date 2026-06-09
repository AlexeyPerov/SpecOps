# OpenCode sidecar binaries

Place platform-specific OpenCode binaries here before production builds.

Tauri expects files named `opencode-<target-triple>` (for example
`opencode-aarch64-apple-darwin`). During development, the sidecar manager
falls back to an `opencode` executable on `PATH` when bundled binaries are
not present.
