import { describe, expect, it } from "vitest";
import {
  DEBUG_PROVIDER_DISABLED_SEND_HINT,
  defaultDebugProviderSettings,
  getDebugProviderSendBlockHint,
  isDebugProviderSendBlocked,
  normalizeDebugProviderSettings,
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
      isDebugProviderSendBlocked("debug", { ...defaultDebugProviderSettings, enabled: false }),
    ).toBe(true);
    expect(
      isDebugProviderSendBlocked("debug", { ...defaultDebugProviderSettings, enabled: true }),
    ).toBe(false);
    expect(isDebugProviderSendBlocked("glm", defaultDebugProviderSettings)).toBe(false);
    expect(isDebugProviderSendBlocked(undefined, defaultDebugProviderSettings)).toBe(false);
  });

  it("exposes a recovery hint pointing to Developer Settings", () => {
    expect(getDebugProviderSendBlockHint()).toBe(DEBUG_PROVIDER_DISABLED_SEND_HINT);
    expect(getDebugProviderSendBlockHint()).toContain("Developer Settings");
  });
});
