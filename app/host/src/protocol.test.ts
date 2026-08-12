import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  MAX_MESSAGE_BYTES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  INITIALIZE_TIMEOUT_MS,
  MAX_CONCURRENT_TURNS,
  ProtocolErrorCode,
  RequestMethod,
  isRequestMethod,
  classifyIncoming,
  decodeInitialize,
  decodeNativeSessionRef,
  decodeTurnSend,
  decodeSessionCreate,
  decodeAuth,
  decodePermissionReply,
  makeResponse,
  makeErrorResponse,
  makeNotification,
} from "./protocol";
import { PROTOCOL_FIXTURES, VALID_INITIALIZE } from "./fixtures";

describe("protocol constants", () => {
  it("defines a versioned protocol with limits and timeouts", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(MAX_MESSAGE_BYTES).toBeGreaterThan(0);
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(INITIALIZE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(MAX_CONCURRENT_TURNS).toBeGreaterThan(0);
  });

  it("defines standard JSON-RPC + custom error codes", () => {
    expect(ProtocolErrorCode.PARSE_ERROR).toBe(-32700);
    expect(ProtocolErrorCode.PROTOCOL_VERSION_MISMATCH).toBeLessThan(-32000 + 100);
    expect(ProtocolErrorCode.ADAPTER_ERROR).toBeDefined();
  });

  it("enumerates the mandatory request methods", () => {
    expect(RequestMethod.Initialize).toBe("initialize");
    expect(RequestMethod.TurnSend).toBe("turn.send");
    expect(isRequestMethod("initialize")).toBe(true);
    expect(isRequestMethod("bogus")).toBe(false);
  });
});

describe("classifyIncoming", () => {
  it("classifies valid fixtures and rejects non-jsonrpc shapes", () => {
    const initialize = classifyIncoming(JSON.parse(VALID_INITIALIZE));
    expect(initialize.kind).toBe("request");

    const notification = classifyIncoming({ jsonrpc: "2.0", method: "noop" });
    expect(notification.kind).toBe("notification");

    expect(classifyIncoming({}).kind).toBe("invalid");
    expect(classifyIncoming({ jsonrpc: "1.0", id: 1, method: "x" }).kind).toBe("invalid");
    expect(classifyIncoming("nope").kind).toBe("invalid");
  });

  it("rejects responses (the host sends no requests)", () => {
    expect(classifyIncoming({ jsonrpc: "2.0", id: 1, result: {} }).kind).toBe("invalid");
    expect(classifyIncoming({ jsonrpc: "2.0", id: 1, error: { code: 1, message: "x" } }).kind).toBe("invalid");
  });

  it("classifies every golden fixture by category", () => {
    for (const fixture of PROTOCOL_FIXTURES) {
      if (fixture.category === "malformed") {
        // Malformed JSON does not reach classifyIncoming (framing rejects it);
        // valid-JSON-but-not-rpc still classifies as invalid here.
        continue;
      }
      const parsed = JSON.parse(fixture.line);
      const classified = classifyIncoming(parsed);
      if (fixture.category === "valid" || fixture.category === "unknown") {
        expect(["request", "notification"]).toContain(classified.kind);
      }
    }
  });
});

describe("version negotiation", () => {
  it("accepts a matching protocol version", () => {
    const decoded = decodeInitialize({ protocolVersion: PROTOCOL_VERSION });
    expect(decoded.ok).toBe(true);
  });

  it("rejects a non-finite protocol version", () => {
    expect(decodeInitialize({ protocolVersion: "1" }).ok).toBe(false);
    expect(decodeInitialize({ protocolVersion: Number.NaN }).ok).toBe(false);
  });
});

describe("param decoders", () => {
  it("decodes a native session ref and rejects unknown runtimes", () => {
    const ok = decodeNativeSessionRef({ runtimeId: "fake", nativeSessionId: "n1" });
    expect(ok.ok).toBe(true);
    const bad = decodeNativeSessionRef({ runtimeId: "gemini", nativeSessionId: "n1" });
    expect(bad.ok).toBe(false);
    expect(decodeNativeSessionRef({ runtimeId: "fake" }).ok).toBe(false);
  });

  it("decodes a turn.send payload and rejects missing fields", () => {
    const ok = decodeTurnSend({
      turnId: "sos-turn-1",
      native: { runtimeId: "fake", nativeSessionId: "n1" },
      workspaceRootPath: "/ws",
      prompt: "hi",
    });
    expect(ok.ok).toBe(true);
    expect(decodeTurnSend({ native: { runtimeId: "fake", nativeSessionId: "n1" } }).ok).toBe(false);
    expect(decodeTurnSend({ turnId: "t", native: { runtimeId: "fake", nativeSessionId: "n1" }, workspaceRootPath: "/ws" }).ok).toBe(false);
  });

  it("decodes session.create and auth payloads", () => {
    expect(decodeSessionCreate({ runtimeId: "fake", workspaceRootPath: "/ws" }).ok).toBe(true);
    expect(decodeSessionCreate({ runtimeId: "bogus", workspaceRootPath: "/ws" }).ok).toBe(false);
    expect(decodeAuth({ runtimeId: "fake", workspaceRootPath: "/ws" }).ok).toBe(true);
  });

  it("validates permission reply values", () => {
    expect(decodePermissionReply({
      native: { runtimeId: "fake", nativeSessionId: "n1" },
      turnId: "t1",
      permissionId: "p1",
      reply: "once",
    }).ok).toBe(true);
    expect(decodePermissionReply({
      native: { runtimeId: "fake", nativeSessionId: "n1" },
      turnId: "t1",
      permissionId: "p1",
      reply: "maybe",
    }).ok).toBe(false);
  });
});

describe("message builders", () => {
  it("build response / error / notification envelopes", () => {
    expect(makeResponse(1, { ok: true })).toMatchObject({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    const err = makeErrorResponse(1, { code: -32601, message: "nope" });
    expect(err.error?.code).toBe(-32601);
    expect(makeNotification("session.event", { x: 1 }).method).toBe("session.event");
  });
});
