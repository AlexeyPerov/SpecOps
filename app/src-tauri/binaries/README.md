# OpenCode sidecar binaries

Place platform-specific OpenCode binaries here before production builds.

Tauri expects files named `opencode-<target-triple>` (for example
`opencode-aarch64-apple-darwin`). During development, the sidecar manager
falls back to an `opencode` executable on `PATH` when bundled binaries are
not present.

## Updating the bundled binaries

The maintainer script [`../../../scripts/update-opencode-sidecar.sh`](../../../scripts/update-opencode-sidecar.sh)
downloads the matching CLI release from `anomalyco/opencode`, extracts the
binary from its `.zip` / `.tar.gz` archive, and writes it to this directory.

Run from the repo root:

```sh
# refresh only the host OS triple to the latest GitHub release
./scripts/update-opencode-sidecar.sh

# pin to a specific release tag
./scripts/update-opencode-sidecar.sh --version v1.17.7

# report drift across every supported triple (no writes)
./scripts/update-opencode-sidecar.sh --platform all --check-only

# refresh every supported triple (release prep; usually run on a maintainer machine)
./scripts/update-opencode-sidecar.sh --platform all
```

Or via npm:

```sh
npm --prefix app run update-opencode-sidecar
npm --prefix app run update-opencode-sidecar -- --version v1.17.7
npm --prefix app run update-opencode-sidecar -- --platform all --check-only
```

After the script writes new binaries:

1. Re-run `./scripts/update-opencode-sidecar.sh --check-only` to confirm
   the installed version matches what you intend to ship.
2. `git add app/src-tauri/binaries/opencode-*`
3. `git commit -m 'chore: refresh bundled opencode binaries to vX.Y.Z'`
4. Consider aligning `@opencode-ai/sdk` in `app/package.json` to the same
   release version (the script does not touch the SDK lockfile).

## Sidecar asset → Tauri triple mapping

The script hard-codes the downloadable sidecar mapping below; if the upstream
project publishes new asset names, edit `PLATFORM_MAP` in
`update-opencode-sidecar.sh` first. This table describes sidecars that the
maintainer script can prepare, not SpecOps release targets: GitHub releases
currently publish SpecOps only for macOS and Windows. Linux is test-CI and
local-build coverage only.

| Release asset                       | Tauri target triple          |
| ----------------------------------- | ---------------------------- |
| `opencode-darwin-arm64.zip`         | `aarch64-apple-darwin`       |
| `opencode-darwin-x64.zip`           | `x86_64-apple-darwin`        |
| `opencode-linux-arm64.tar.gz`       | `aarch64-unknown-linux-gnu`  |
| `opencode-linux-x64.tar.gz`         | `x86_64-unknown-linux-gnu`   |
| `opencode-windows-x64.zip`          | `x86_64-pc-windows-msvc.exe` |

`*-baseline` (older CPUs without AVX2) and `*-musl` (Linux musl libc)
variants exist on the release page but are not pulled by default. To use
one of those, edit the script's `PLATFORM_MAP` entry to the variant
filename (e.g. `opencode-darwin-x64-baseline.zip`).

## Manual fallback

If the script fails (e.g. an asset renamed upstream), download the
matching asset manually:

```sh
# 1. Visit https://github.com/anomalyco/opencode/releases/tag/<tag>
# 2. Download the CLI asset for your platform (see mapping above)
# 3. Extract the inner `opencode` (or `opencode.exe` on Windows) binary
# 4. Move it to this directory as `opencode-<target-triple>`
# 5. chmod +x app/src-tauri/binaries/opencode-<target-triple>
# 6. ./scripts/update-opencode-sidecar.sh --check-only   # sanity check
```

Then commit the resulting binary. Document the manual step in the PR
description so the maintainer script can be fixed in a follow-up.