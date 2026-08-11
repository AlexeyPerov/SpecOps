import { describe, expect, it } from "vitest";
import { redactForSerialization, redactSecretStringValue, toUnknownNativeDiagnostic, toMalformedDiagnostic } from "./redact";
import { asNativeSessionId } from "./ids";
import type { SessionEvent } from "./events";

describe("redaction", () => {
  it("strips bearer tokens and known key patterns", () => {
    expect(redactSecretStringValue("Bearer abc123XYZ")).toBe("[redacted]");
    expect(redactSecretStringValue("sk-" + "a".repeat(20))).toBe("[redacted]");
  });

  it("recursively redacts object keys named like secrets, keeps safe values", () => {
    const redacted = redactForSerialization({
      authorization: "Bearer secret",
      model: "claude-4",
      nested: { "x-api-key": "sk-" + "x".repeat(20), label: "ok" },
      tokens: ["Bearer leaked", "plain"],
    }) as Record<string, unknown>;
    expect(redacted.authorization).toBe("[redacted]");
    expect(redacted.model).toBe("claude-4");
    const nested = redacted.nested as Record<string, unknown>;
    expect(nested["x-api-key"]).toBe("[redacted]");
    expect(nested.label).toBe("ok");
    const tokens = redacted.tokens as unknown[];
    expect(tokens[0]).toBe("[redacted]");
    expect(tokens[1]).toBe("plain");
  });

  it("truncates very long strings", () => {
    const long = "x".repeat(5_000);
    const redacted = redactForSerialization(long) as string;
    expect(redacted.length).toBeLessThan(5_000);
    expect(redacted).toContain("[redacted");
  });
});

describe("unknown-native diagnostic coercion", () => {
  it("wraps an unrecognized native event as a diagnostic with redacted payload", () => {
    const event = toUnknownNativeDiagnostic({
      nativeSessionId: asNativeSessionId("n-1"),
      seq: 7,
      at: "2026-01-01T00:00:00.000Z",
      raw: { type: "mystery", authorization: "Bearer leaked" },
    });
    expect(event.type).toBe("diagnostic");
    expect(event.reason).toBe("unknown-native");
    if (event.redactedRaw && typeof event.redactedRaw === "object") {
      expect((event.redactedRaw as Record<string, unknown>).authorization).toBe("[redacted]");
    } else {
      throw new Error("redactedRaw should be an object");
    }
  });

  it("malformed diagnostic carries a warning level", () => {
    const event = toMalformedDiagnostic({
      nativeSessionId: asNativeSessionId("n-1"),
      seq: 1,
      at: "t",
      raw: "garbage",
      message: "bad shape",
    });
    expect(event.level).toBe("warn");
    expect(event.reason).toBe("malformed");
  });

  it("the SessionEvent union accepts every documented kind (type-level smoke)", () => {
    const nativeSessionId = asNativeSessionId("n-1");
    const samples: SessionEvent[] = [
      { type: "status.changed", nativeSessionId, seq: 1, at: "t", status: "running" },
      { type: "compaction.applied", nativeSessionId, seq: 2, at: "t", removedMessageCount: 3 },
      { type: "permission.requested", nativeSessionId, seq: 3, at: "t", turnId: "sos-turn-1" as never, request: { permissionId: "p", label: "x" } },
      { type: "question.requested", nativeSessionId, seq: 4, at: "t", turnId: "sos-turn-1" as never, request: { questionId: "q", prompt: "?" } },
    ];
    expect(samples.map((event) => event.type)).toEqual([
      "status.changed",
      "compaction.applied",
      "permission.requested",
      "question.requested",
    ]);
  });
});
