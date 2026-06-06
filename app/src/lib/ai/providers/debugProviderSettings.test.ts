import { describe, expect, it } from "vitest";
import { defaultAppProviderSettings } from "./appProviderSettings";
import {
  DEBUG_AI_PROVIDER_DISABLED_MESSAGE,
  DEBUG_AI_PROVIDER_DISABLED_RECOVERY,
} from "../chatErrorCopy";
import {
  defaultDebugProviderSettings,
  getDebugProviderSendBlockHint,
  getDebugProviderSendBlockRecovery,
  isDebugProviderEnabled,
  isDebugProviderSendBlocked,
  coerceProviderForScope,
  normalizeDebugProviderSettings,
  normalizeLegacyChatProviderId,
} from "./debugProviderSettings";

describe("normalizeDebugProviderSettings", () => {
  it("returns safe defaults when input is missing", () => {
    expect(normalizeDebugProviderSettings()).toEqual(defaultDebugProviderSettings);
    expect(defaultDebugProviderSettings.enabled).toBe(true);
    expect(defaultDebugProviderSettings.failureProbability).toBe(0);
  });

  it("preserves valid settings", () => {
    expect(
      normalizeDebugProviderSettings({
        enabled: true,
        simulationSeed: 42,
        delayMsMin: 100,
        delayMsMax: 500,
        chunkCharsMin: 4,
        chunkCharsMax: 16,
        failureProbability: 0.25,
        failureMessage: "Boom",
        includeDiagnostics: false,
      }),
    ).toEqual({
      enabled: true,
      simulationSeed: 42,
      delayMsMin: 100,
      delayMsMax: 500,
      chunkCharsMin: 4,
      chunkCharsMax: 16,
      failureProbability: 0.25,
      failureMessage: "Boom",
      includeDiagnostics: false,
    });
  });

  it("clamps failure probability to 0..1", () => {
    expect(normalizeDebugProviderSettings({ failureProbability: -0.5 }).failureProbability).toBe(0);
    expect(normalizeDebugProviderSettings({ failureProbability: 2 }).failureProbability).toBe(1);
  });

  it("ensures min is not greater than max for delay and chunk ranges", () => {
    const delay = normalizeDebugProviderSettings({ delayMsMin: 900, delayMsMax: 100 });
    expect(delay.delayMsMin).toBe(900);
    expect(delay.delayMsMax).toBe(900);

    const chunk = normalizeDebugProviderSettings({ chunkCharsMin: 40, chunkCharsMax: 10 });
    expect(chunk.chunkCharsMin).toBe(40);
    expect(chunk.chunkCharsMax).toBe(40);
  });

  it("normalizes blank simulation seed to null", () => {
    expect(normalizeDebugProviderSettings({ simulationSeed: null }).simulationSeed).toBeNull();
    expect(normalizeDebugProviderSettings({ simulationSeed: "" as unknown as null }).simulationSeed).toBeNull();
  });

  it("falls back to default failure message when blank", () => {
    expect(normalizeDebugProviderSettings({ failureMessage: "   " }).failureMessage).toBe(
      defaultDebugProviderSettings.failureMessage,
    );
  });
});

describe("debug provider send blocking", () => {
  it("blocks send when debug is selected but disabled in settings", () => {
    expect(
      isDebugProviderSendBlocked("debug-workspace", {
        ...defaultAppProviderSettings,
        debugWorkspace: { ...defaultDebugProviderSettings, enabled: false },
      }),
    ).toBe(true);
    expect(
      isDebugProviderSendBlocked("debug-chat", {
        ...defaultAppProviderSettings,
        debugChat: { ...defaultDebugProviderSettings, enabled: false },
      }),
    ).toBe(true);
    expect(
      isDebugProviderSendBlocked("debug-workspace", defaultAppProviderSettings),
    ).toBe(false);
    expect(isDebugProviderSendBlocked("http", defaultAppProviderSettings)).toBe(false);
    expect(isDebugProviderSendBlocked(undefined, defaultAppProviderSettings)).toBe(false);
  });

  it("exposes scoped recovery hints", () => {
    expect(getDebugProviderSendBlockHint("debug-chat")).toBe(DEBUG_AI_PROVIDER_DISABLED_MESSAGE);
    expect(getDebugProviderSendBlockRecovery("debug-chat")).toContain("Debug Provider");
    expect(getDebugProviderSendBlockRecovery("debug-workspace")).toContain("Debug Provider");
  });

  it("maps legacy debug provider ids by scope on load", () => {
    expect(normalizeLegacyChatProviderId("debug", "chat-http")).toBe("debug-chat");
    expect(normalizeLegacyChatProviderId("debug", "/work/a")).toBe("debug-workspace");
    expect(isDebugProviderEnabled("debug-chat", defaultAppProviderSettings)).toBe(true);
  });

  it("coerces scoped debug providers when chat scope changes", () => {
    expect(coerceProviderForScope("debug-workspace", "chat-http")).toBe("debug-chat");
    expect(coerceProviderForScope("debug-chat", "/work/a")).toBe("debug-workspace");
    expect(coerceProviderForScope("http", "chat-http")).toBe("http");
  });
});
