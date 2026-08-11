import { describe, expect, it } from "vitest";
import { createSessionRef, rebindRuntime } from "./binding";
import {
  mintSpecOpsTurnId,
  asSpecOpsTurnId,
  resetSessionIdCountersForTests,
} from "./ids";
import { appendUserTurn, applySessionEvent, emptyTranscript } from "./transcript";
import { asNativeSessionId } from "./ids";
import {
  createSessionStoreIndex,
  toSessionStoreIndexEntry,
  upsertSessionStoreIndexEntry,
  type SessionRecord,
} from "./record";
import {
  decodeSessionRecord,
  decodeSessionStoreIndex,
  encodeSessionRecord,
  encodeSessionStoreIndex,
} from "./codec";

function sampleRecord(): SessionRecord {
  resetSessionIdCountersForTests();
  const session = createSessionRef({
    runtimeId: "claude",
    nativeSessionId: "native-1",
    workspaceRootPath: "/ws",
    modelId: "claude-4",
    capabilities: ["permissions", "share"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    runtimeMetadata: { region: "us", note: "Bearer secret-leak" },
  });
  const userTurn = mintSpecOpsTurnId();
  const assistantTurn = mintSpecOpsTurnId();
  const native = asNativeSessionId("native-1");
  const transcript = [
    { type: "turn.started", nativeSessionId: native, seq: 1, at: "t", turnId: assistantTurn },
    { type: "text.delta", nativeSessionId: native, seq: 2, at: "t", turnId: assistantTurn, delta: "Hi" },
    { type: "turn.finished", nativeSessionId: native, seq: 3, at: "t", turnId: assistantTurn },
  ].reduce(
    (acc, event) => applySessionEvent(acc, event as never),
    appendUserTurn(emptyTranscript(), { id: userTurn, content: "hi", at: "t" }),
  );
  return { version: 1, session, transcript };
}

describe("session record codec", () => {
  it("round-trips deterministically (encode → decode → encode is byte-identical)", () => {
    const record = sampleRecord();
    const encoded1 = encodeSessionRecord(record);
    const decoded = decodeSessionRecord(encoded1);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const encoded2 = encodeSessionRecord(decoded.value);
    expect(encoded2).toBe(encoded1);
    expect(decoded.value.session.id).toBe(record.session.id);
    expect(decoded.value.transcript.turns).toHaveLength(2);
  });

  it("canonicalizes key order (alphabetical, independent of insertion order)", () => {
    const record = sampleRecord();
    const encoded = encodeSessionRecord(record);
    expect(encoded.indexOf('"session"')).toBeLessThan(encoded.indexOf('"transcript"'));
    expect(encoded.indexOf('"transcript"')).toBeLessThan(encoded.indexOf('"version"'));
  });

  it("redacts secrets from the encoded payload", () => {
    const record = sampleRecord();
    const encoded = encodeSessionRecord(record);
    expect(encoded).not.toContain("secret-leak");
    expect(encoded).toContain("[redacted]");
  });

  it("fails explicitly on malformed input (no silent partial decode)", () => {
    const cases: Array<[string, string]> = [
      ["not json", "{not json"],
      ["wrong version", JSON.stringify({ version: 99, session: {}, transcript: {} })],
      ["missing session", JSON.stringify({ version: 1, transcript: { turns: [] } })],
      ["bad runtime", JSON.stringify({ version: 1, session: { id: "s", runtimeId: "gemini", native: { runtimeId: "gemini", nativeSessionId: "n" }, workspaceRootPath: "/ws", createdAt: "t", updatedAt: "t", status: "idle" }, transcript: { turns: [] } })],
      ["runtime mismatch", JSON.stringify({ version: 1, session: { id: "s", runtimeId: "claude", native: { runtimeId: "codex", nativeSessionId: "n" }, workspaceRootPath: "/ws", createdAt: "t", updatedAt: "t", status: "idle" }, transcript: { turns: [] } })],
      ["bad status", JSON.stringify({ version: 1, session: { id: "s", runtimeId: "claude", native: { runtimeId: "claude", nativeSessionId: "n" }, workspaceRootPath: "/ws", createdAt: "t", updatedAt: "t", status: "flying" }, transcript: { turns: [] } })],
      ["malformed turn", JSON.stringify({ version: 1, session: { id: "s", runtimeId: "claude", native: { runtimeId: "claude", nativeSessionId: "n" }, workspaceRootPath: "/ws", createdAt: "t", updatedAt: "t", status: "idle" }, transcript: { turns: [{ id: "x", role: "assistant" }] } })],
    ];
    for (const [name, raw] of cases) {
      const result = decodeSessionRecord(raw);
      expect(result.ok, name).toBe(false);
      if (!result.ok) {
        expect(result.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("preserves immutable runtime + rebind link across round-trip", () => {
    resetSessionIdCountersForTests();
    const original = createSessionRef({
      runtimeId: "claude",
      nativeSessionId: "c-1",
      workspaceRootPath: "/ws",
    });
    const forked = rebindRuntime(original, {
      runtimeId: "codex",
      nativeSessionId: "o-1",
      linkAsParent: true,
    });
    const encoded = encodeSessionRecord({
      version: 1,
      session: forked,
      transcript: emptyTranscript(),
    });
    const decoded = decodeSessionRecord(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.session.runtimeId).toBe("codex");
    expect(decoded.value.session.native.parentSessionId).toBe(original.id);
  });
});

describe("session store index codec", () => {
  it("round-trips an index and survives a re-encode", () => {
    resetSessionIdCountersForTests();
    const session = createSessionRef({
      runtimeId: "opencode",
      nativeSessionId: "oc-1",
      workspaceRootPath: "/ws",
    });
    const index = upsertSessionStoreIndexEntry(
      createSessionStoreIndex("/ws"),
      toSessionStoreIndexEntry(session, "My session"),
    );
    const encoded1 = encodeSessionStoreIndex(index);
    const decoded = decodeSessionStoreIndex(encoded1);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const encoded2 = encodeSessionStoreIndex(decoded.value);
    expect(encoded2).toBe(encoded1);
    expect(decoded.value.sessions[0].runtimeId).toBe("opencode");
  });

  it("fails explicitly on corrupt index payloads", () => {
    expect(decodeSessionStoreIndex("{").ok).toBe(false);
    expect(
      decodeSessionStoreIndex(JSON.stringify({ version: 1, workspaceRootPath: "/ws", sessions: "nope" })).ok,
    ).toBe(false);
    expect(
      decodeSessionStoreIndex(
        JSON.stringify({
          version: 1,
          workspaceRootPath: "/ws",
          sessions: [{ id: "x", runtimeId: "gemini", nativeSessionId: "n", title: "t", lastTurnAt: "t", status: "idle" }],
        }),
      ).ok,
    ).toBe(false);
  });
});

// Quiet the unused-import linter for the asSpecOpsTurnId helper kept for clarity.
void asSpecOpsTurnId;
