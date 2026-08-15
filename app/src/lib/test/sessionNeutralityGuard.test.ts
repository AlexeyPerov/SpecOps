import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase F absence guard (AS01-F-04).
 *
 * The common UI/state surface must stay runtime-neutral:
 *   - no provider-prefixed session field anywhere in common code;
 *   - no vendor SDK import outside the phase-04 adapter-candidate backends;
 *   - the store, domain types, and the send pipeline carry no `opencode*`
 *     identifiers at all (the pipeline drives the Agent Host client).
 *
 * The OpenCode settings gate + settings panels keep their identifiers until
 * the settings surface is renamed (documented follow-up cleanup).
 */

const SRC_ROOT = join(import.meta.dirname, "..");

/** Common directories the neutral-domain guarantee covers. */
const COMMON_DIRS = [
  "state",
  "domain",
  "services",
  "components",
  "session",
] as const;

/** Extra single files outside the directories above. */
const EXTRA_FILES = ["ai/sendChatMessage.ts", "ai/chatSendPipeline.ts"] as const;

/** Provider-prefixed session field names that must not exist in common code. */
const PROVIDER_SESSION_FIELD_PATTERN = /opencode(SessionId|ModelId|ProviderId|ShareUrl|ParentSessionId|AgentId)/;

/** Directives that import the vendor SDK. */
const SDK_IMPORT_PATTERN = /from\s+["']@opencode-ai\/sdk/;

/**
 * Files that must be fully free of `opencode*` identifiers (case-sensitive
 * `opencode` followed by an uppercase letter). The settings gate rename is
 * tracked separately, so gate-consuming files are excluded here.
 */
const STRICT_NEUTRAL_TARGETS = [
  "domain/chat.ts",
  "ai/chatSendPipeline.ts",
  "state/chatStore/sessions.ts",
  "state/chatStore/threadHelpers.ts",
  "state/chatStore/threadMetadata.ts",
  "services/chatPersistenceCodec.ts",
] as const;

const STRICT_NEUTRAL_PATTERN = /opencode[A-Z]/;

function listSourceFiles(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) {
      continue;
    }
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      entries.push(...listSourceFiles(full));
    } else if (/\.(ts|svelte)$/.test(name)) {
      entries.push(full);
    }
  }
  return entries;
}

function read(relPath: string): string {
  return readFileSync(join(SRC_ROOT, relPath), "utf8");
}

function commonScopeFiles(): string[] {
  const files: string[] = [];
  for (const dir of COMMON_DIRS) {
    files.push(...listSourceFiles(join(SRC_ROOT, dir)));
  }
  for (const file of EXTRA_FILES) {
    files.push(join(SRC_ROOT, file));
  }
  return files;
}

function toRelative(full: string): string {
  return full.slice(SRC_ROOT.length + 1);
}

describe("runtime-neutral absence guard (phase F)", () => {
  it("common code contains no provider-prefixed session field", () => {
    const offenders = commonScopeFiles()
      .map((file) => ({ file: toRelative(file), content: read(toRelative(file)) }))
      .filter(({ content }) => PROVIDER_SESSION_FIELD_PATTERN.test(content))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("common code contains no vendor SDK imports", () => {
    const offenders = commonScopeFiles()
      .map((file) => ({ file: toRelative(file), content: read(toRelative(file)) }))
      .filter(({ content }) => SDK_IMPORT_PATTERN.test(content))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("store, domain types, and the send pipeline are free of provider identifiers", () => {
    for (const target of STRICT_NEUTRAL_TARGETS) {
      expect(PROVIDER_SESSION_FIELD_PATTERN.test(read(target))).toBe(false);
      expect(
        STRICT_NEUTRAL_PATTERN.test(read(target)),
        `${target} must not contain opencode* identifiers`,
      ).toBe(false);
    }
  });

  it("the send pipeline drives the Agent Host client, not a workspace backend", () => {
    const pipeline = read("ai/chatSendPipeline.ts");
    expect(pipeline).toContain("getAgentHostClient");
    expect(pipeline).toContain("ensureAgentHostStarted");
    expect(pipeline).not.toMatch(/from "\.\/backends\//);
    expect(read("ai/sendChatMessage.ts")).not.toMatch(/from "\.\/backends\//);
  });
});
