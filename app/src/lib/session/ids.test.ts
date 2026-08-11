import { describe, expect, it } from "vitest";
import {
  asNativeSessionId,
  asSpecOpsSessionId,
  asSpecOpsTurnId,
  mintSpecOpsSessionId,
  mintSpecOpsTurnId,
  resetSessionIdCountersForTests,
  SessionIdParseError,
} from "./ids";

describe("session id brand separation", () => {
  it("brands are compile-time distinct (assignability is rejected at the type level)", () => {
    // Runtime sanity: each factory returns the validated string value.
    const session = asSpecOpsSessionId("sos-session-1");
    const turn = asSpecOpsTurnId("sos-turn-1");
    const native = asNativeSessionId("native-1");
    expect(session).toBe("sos-session-1");
    expect(turn).toBe("sos-turn-1");
    expect(native).toBe("native-1");

    // @ts-expect-error — a NativeSessionId is not assignable to a SpecOpsSessionId slot.
    const _mismatch: typeof session = native;
    void _mismatch;
  });

  it("rejects empty / non-string / overlong ids", () => {
    expect(() => asSpecOpsSessionId("")).toThrow(SessionIdParseError);
    expect(() => asSpecOpsSessionId("   ")).toThrow(SessionIdParseError);
    expect(() => asNativeSessionId("x".repeat(257))).toThrow(SessionIdParseError);
    expect(() => asSpecOpsTurnId(undefined as unknown as string)).toThrow(SessionIdParseError);
  });

  it("mints deterministic ids after a counter reset", () => {
    resetSessionIdCountersForTests();
    expect(mintSpecOpsSessionId()).toBe("sos-session-1");
    expect(mintSpecOpsTurnId()).toBe("sos-turn-1");
    expect(mintSpecOpsSessionId()).toBe("sos-session-2");
  });
});
