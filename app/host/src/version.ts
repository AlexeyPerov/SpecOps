/**
 * Build/version metadata (phase D, task AS01-D-01).
 *
 * The deterministic identity is {@link HOST_VERSION} + {@link PROTOCOL_VERSION}
 * (constants). {@link BUILD_GIT} / {@link BUILD_TIME} are injected at build
 * time by `scripts/build.mjs` (esbuild `define`) and are informational; tests
 * assert structure, not absolute timestamps, so the protocol suite stays
 * deterministic across platforms.
 */

declare const __HOST_VERSION__: string | undefined;
declare const __BUILD_GIT__: string | undefined;
declare const __BUILD_TIME__: string | undefined;

/** Host package version (deterministic; sourced from package.json at build). */
export const HOST_VERSION: string = typeof __HOST_VERSION__ !== "undefined" ? __HOST_VERSION__ : "0.0.0-dev";

/** Git short sha at build time ("unknown" when git is unavailable). */
export const BUILD_GIT: string = typeof __BUILD_GIT__ !== "undefined" ? __BUILD_GIT__ : "unknown";

/** ISO build timestamp (informational, not asserted for an exact value). */
export const BUILD_TIME: string = typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "1970-01-01T00:00:00.000Z";

/** Node runtime version the host is running under. */
export const RUNTIME_NODE: string = process.versions.node;

export interface BuildInfo {
  readonly hostVersion: string;
  readonly git: string;
  readonly time: string;
  readonly node: string;
}

export function buildInfo(): BuildInfo {
  return { hostVersion: HOST_VERSION, git: BUILD_GIT, time: BUILD_TIME, node: RUNTIME_NODE };
}
