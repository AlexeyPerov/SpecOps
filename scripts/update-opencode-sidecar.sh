#!/usr/bin/env bash
#
# update-opencode-sidecar.sh — refresh bundled OpenCode CLI binaries.
#
# Downloads platform-specific OpenCode release assets from
# https://github.com/anomalyco/opencode/releases, extracts the CLI binary
# from each archive, and writes it into the Tauri `externalBin` layout
# (app/src-tauri/binaries/opencode-<triple>).
#
# Asset → Rust target-triple mapping (maintained in this script):
#
#   opencode-darwin-arm64.zip       → aarch64-apple-darwin
#   opencode-darwin-x64.zip         → x86_64-apple-darwin
#   opencode-linux-arm64.tar.gz     → aarch64-unknown-linux-gnu
#   opencode-linux-x64.tar.gz       → x86_64-unknown-linux-gnu
#   opencode-windows-x64.zip        → x86_64-pc-windows-msvc.exe
#
# (The OpenCode release page publishes both `*-baseline` variants — older
# CPUs without AVX2 — and `*-musl` Linux variants. This script picks the
# default non-musl, non-baseline asset per triple; override the asset name
# via the `--asset-map` option if your target needs a specific variant.)
#
# Usage:
#   ./scripts/update-opencode-sidecar.sh [--version latest|vX.Y.Z]
#                                        [--platform current|all]
#                                        [--check-only]
#
# Exit codes:
#   0  success (or check-only reported status)
#   1  generic failure
#   2  invalid arguments
#   3  GitHub release / asset not found (404)

set -euo pipefail

REPO_OWNER="anomalyco"
REPO_NAME="opencode"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}"
BINARIES_DIR="app/src-tauri/binaries"

# Asset archive → Tauri externalBin suffix (Rust target triple).
# Order matters for `--platform all`; the script writes every entry.
PLATFORM_MAP=(
  "opencode-darwin-arm64.zip|aarch64-apple-darwin|opencode"
  "opencode-darwin-x64.zip|x86_64-apple-darwin|opencode"
  "opencode-linux-arm64.tar.gz|aarch64-unknown-linux-gnu|opencode"
  "opencode-linux-x64.tar.gz|x86_64-unknown-linux-gnu|opencode"
  "opencode-windows-x64.zip|x86_64-pc-windows-msvc.exe|opencode.exe"
)

VERSION_ARG="latest"
PLATFORM_ARG="current"
CHECK_ONLY=0

log()  { printf '\033[1;34m[update-opencode-sidecar]\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m[update-opencode-sidecar]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[update-opencode-sidecar]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  cat <<EOF
Usage: $(basename "$0") [--version latest|vX.Y.Z] [--platform current|all] [--check-only]

Options:
  --version <ref>       Release to fetch. "latest" (default) tracks the most
                        recent GitHub release. A pinned tag like "v1.17.7" is
                        also accepted.
  --platform <scope>    "current" (default) updates only the host OS triple.
                        "all" updates every supported triple (release prep).
  --check-only          Report bundled vs available versions without writing
                        any files. Exit 0 if up-to-date, 1 otherwise.

Examples:
  $(basename "$0")                              # update local triple to latest
  $(basename "$0") --version v1.17.7            # pin to a specific release
  $(basename "$0") --platform all --check-only  # report drift across all triples
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)
        [[ $# -ge 2 ]] || die "--version requires an argument"
        VERSION_ARG="$2"
        shift 2
        ;;
      --platform)
        [[ $# -ge 2 ]] || die "--platform requires an argument"
        PLATFORM_ARG="$2"
        shift 2
        ;;
      --check-only)
        CHECK_ONLY=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown argument: $1 (try --help)"
        ;;
    esac
  done

  case "$PLATFORM_ARG" in
    current|all) ;;
    *) die "Invalid --platform '$PLATFORM_ARG' (expected 'current' or 'all')";;
  esac
}

# Resolve the requested version ref to a concrete release tag.
#
# Sets the globals:
#   RESOLVED_TAG    — e.g. "v1.17.7"
#   DOWNLOAD_BASE   — base URL for assets under that tag
resolve_version() {
  local ref="$1"
  if [[ "$ref" == "latest" ]]; then
    local api_url="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
    local body
    if body="$(curl -fsSL --connect-timeout 10 \
                  -H 'Accept: application/vnd.github+json' \
                  -H 'X-GitHub-Api-Version: 2022-11-28' \
                  "$api_url" 2>/dev/null)"; then
      local tag
      tag="$(printf '%s' "$body" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(data.get('tag_name', ''))
" 2>/dev/null || true)"
      if [[ -n "$tag" ]]; then
        RESOLVED_TAG="$tag"
        DOWNLOAD_BASE="${REPO_URL}/releases/download/${RESOLVED_TAG}"
        return 0
      fi
    fi
    warn "GitHub API did not return a tag; falling back to /releases/latest redirect."
    local location
    location="$(curl -sSL -o /dev/null -w '%{url_effective}' --connect-timeout 10 \
      "${REPO_URL}/releases/latest")"
    local tag="${location##*/}"
    if [[ -z "$tag" || "$tag" == "releases" ]]; then
      die "Could not resolve the latest release tag from ${REPO_URL}/releases/latest"
    fi
    RESOLVED_TAG="$tag"
    DOWNLOAD_BASE="${REPO_URL}/releases/download/${RESOLVED_TAG}"
    return 0
  fi

  local tag="$ref"
  if [[ "$tag" != v* ]]; then
    tag="v${tag}"
  fi
  local head_status
  head_status="$(curl -sIL --connect-timeout 10 -o /dev/null -w '%{http_code}' \
    "${REPO_URL}/releases/tag/${tag}")"
  case "$head_status" in
    200|301|302) ;;
    404) die "Release tag '${tag}' not found at ${REPO_URL}/releases/tag/${tag}";;
    *) die "Unexpected HTTP ${head_status} when resolving '${tag}'";;
  esac
  RESOLVED_TAG="$tag"
  DOWNLOAD_BASE="${REPO_URL}/releases/download/${RESOLVED_TAG}"
}

# Detect the host triple suffix used by Tauri `externalBin`.
detect_host_triple() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "${os}:${arch}" in
    Darwin:arm64)   echo "aarch64-apple-darwin" ;;
    Darwin:x86_64)  echo "x86_64-apple-darwin" ;;
    Linux:x86_64)   echo "x86_64-unknown-linux-gnu" ;;
    Linux:aarch64)  echo "aarch64-unknown-linux-gnu" ;;
    MINGW*:x86_64)  echo "x86_64-pc-windows-msvc.exe" ;;
    *)              return 1 ;;
  esac
}

# Read the version reported by an existing binary, or empty string if it
# cannot be invoked.
binary_version() {
  local bin="$1"
  if [[ ! -x "$bin" ]]; then
    echo ""
    return 0
  fi
  local out
  if out="$("$bin" --version 2>/dev/null | head -n1)"; then
    local trimmed="${out##*version }"
    trimmed="${trimmed%% *}"
    trimmed="${trimmed#v}"
    echo "$trimmed"
  else
    echo ""
  fi
}

# Verify a payload looks like a real executable (not an HTML error page).
verify_binary_payload() {
  local file="$1"
  local magic_hex
  magic_hex="$(head -c 4 "$file" | xxd -p 2>/dev/null || true)"
  case "$magic_hex" in
    cffaedfe|feedface|cefaedfe|feedfacf) return 0 ;;  # Mach-O
    7f454c46)                            return 0 ;;  # ELF
    4d5a*)                               return 0 ;;  # PE / .exe
    *)
      err "Downloaded payload does not look like a binary (magic=${magic_hex:-unknown})."
      return 1
      ;;
  esac
}

# Extract a single named file from a .zip or .tar.gz archive into the given
# destination directory, overwriting any existing file. Returns the path of
# the extracted file on stdout.
extract_archive() {
  local archive="$1"
  local member="$2"
  local dest_dir="$3"
  mkdir -p "$dest_dir"
  case "$archive" in
    *.zip)
      if command -v unzip >/dev/null 2>&1; then
        unzip -o -q -d "$dest_dir" "$archive" "$member"
      else
        python3 - "$archive" "$member" "$dest_dir" <<'PYEOF'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    for info in z.infolist():
        if info.filename == sys.argv[2] and not info.is_dir():
            with z.open(info) as src, open(sys.argv[3] + '/' + info.filename, 'wb') as dst:
                dst.write(src.read())
            break
    else:
        sys.stderr.write(f"member not found: {sys.argv[2]}\n")
        sys.exit(1)
PYEOF
      fi
      ;;
    *.tar.gz|*.tgz)
      tar -xzf "$archive" -C "$dest_dir" "$member"
      ;;
    *)
      die "Unsupported archive format: $archive"
      ;;
  esac
  echo "${dest_dir}/${member}"
}

# Download + extract + install a single triple. Returns 0 on success.
install_triple() {
  local asset="$1"
  local triple="$2"
  local member="$3"
  local dest="${BINARIES_DIR}/opencode-${triple}"

  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    local status
    status="$(curl -sIL --connect-timeout 10 -o /dev/null -w '%{http_code}' \
              "${DOWNLOAD_BASE}/${asset}")"
    if [[ "$status" == "200" || "$status" == "302" ]]; then
      log "OK     ${asset} -> opencode-${triple} (bundled: ${old_version:-none}, target: ${RESOLVED_TAG})"
      return 0
    fi
    warn "MISS   ${asset} -> opencode-${triple} (HTTP ${status})"
    return 3
  fi

  local work
  work="$(mktemp -d -t opencode-sidecar.XXXXXX)"
  # shellcheck disable=SC2064
  trap "rm -rf '$work'" RETURN

  local archive_path="${work}/${asset}"
  log "Downloading ${DOWNLOAD_BASE}/${asset}"
  if ! curl -fL --connect-timeout 30 --retry 3 --retry-delay 2 \
       -o "$archive_path" "${DOWNLOAD_BASE}/${asset}"; then
    rm -rf "$work"
    trap - RETURN
    die "Download failed: ${DOWNLOAD_BASE}/${asset}"
  fi

  local extracted_path
  if ! extracted_path="$(extract_archive "$archive_path" "$member" "$work")"; then
    rm -rf "$work"
    trap - RETURN
    die "Failed to extract '${member}' from ${asset}"
  fi

  if ! verify_binary_payload "$extracted_path"; then
    rm -rf "$work"
    trap - RETURN
    die "Extracted payload is not a valid binary: ${asset}"
  fi

  mkdir -p "$(dirname "$dest")"
  mv "$extracted_path" "$dest"
  chmod +x "$dest" || true
  rm -rf "$work"
  trap - RETURN

  local new_version
  new_version="$(binary_version "$dest" || true)"
  log "Installed: opencode-${triple} (version: ${new_version:-unknown})"
}

main() {
  parse_args "$@"

  if [[ ! -d "$BINARIES_DIR" ]]; then
    die "Expected binaries directory '${BINARIES_DIR}' (run from the repo root)."
  fi

  resolve_version "$VERSION_ARG"
  log "Resolved version: ${RESOLVED_TAG} (ref: ${VERSION_ARG})"

  local host_triple=""
  if [[ "$PLATFORM_ARG" == "current" ]]; then
    if ! host_triple="$(detect_host_triple)"; then
      die "Could not detect a supported host triple (uname: $(uname -s)/$(uname -m))."
    fi
    log "Host triple: ${host_triple}"
  fi

  local any_missing=0
  local any_drift=0
  while IFS='|' read -r asset triple member; do
    [[ -z "$asset" || -z "$triple" ]] && continue
    if [[ "$PLATFORM_ARG" == "current" && "$triple" != "$host_triple" ]]; then
      continue
    fi
    local dest="${BINARIES_DIR}/opencode-${triple}"
    local old_version
    old_version="$(binary_version "$dest" || true)"

    if install_triple "$asset" "$triple" "$member"; then
      if [[ -n "$old_version" && "$old_version" != "${RESOLVED_TAG#v}" ]]; then
        any_drift=1
      fi
    else
      any_missing=1
    fi
  done < <(printf '%s\n' "${PLATFORM_MAP[@]}")

  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    if [[ "$any_missing" -eq 1 || "$any_drift" -eq 1 ]]; then
      exit 1
    fi
    log "All ${PLATFORM_ARG} triples are up-to-date (${RESOLVED_TAG})."
    exit 0
  fi

  log "Done. Remember to:"
  log "  git add app/src-tauri/binaries/opencode-*"
  log "  git commit -m 'chore: refresh bundled opencode binaries to ${RESOLVED_TAG}'"
}

main "$@"