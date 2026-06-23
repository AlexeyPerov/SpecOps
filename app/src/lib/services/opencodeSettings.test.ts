import { describe, expect, it } from "vitest";
import {
  buildOpencodeSidecarBaseUrl,
  defaultOpencodeSettings,
  DEFAULT_OPENCODE_SIDECAR_PORT,
  isOpencodeEnabled,
  isOpencodeSidecarPort,
  MAX_OPENCODE_SIDECAR_PORT,
  MIN_OPENCODE_SIDECAR_PORT,
  normalizeOpencodeSettings,
  OPENCODE_SIDECAR_HOSTNAME,
  validateOpencodeBaseUrl,
  validateOpencodeSidecarPort,
} from "./opencodeSettings";

describe("opencodeSettings", () => {
  it("defaults to sidecar settings with enabled true", () => {
    expect(normalizeOpencodeSettings(undefined)).toEqual(defaultOpencodeSettings);
    expect(defaultOpencodeSettings.enabled).toBe(true);
    expect(defaultOpencodeSettings.mode).toBe("sidecar");
    expect(defaultOpencodeSettings.sidecarPort).toBe(DEFAULT_OPENCODE_SIDECAR_PORT);
    expect(defaultOpencodeSettings.baseUrl).toBe(
      buildOpencodeSidecarBaseUrl(DEFAULT_OPENCODE_SIDECAR_PORT),
    );
  });

  it("normalizes enabled from input", () => {
    expect(normalizeOpencodeSettings({ enabled: false, mode: "sidecar" }).enabled).toBe(false);
    expect(normalizeOpencodeSettings({ mode: "sidecar" }).enabled).toBe(true);
  });

  it("normalizes url mode with trimmed base URL", () => {
    expect(
      normalizeOpencodeSettings({
        enabled: true,
        mode: "url",
        baseUrl: " https://opencode.example.com ",
        sidecarPort: 4096,
      }),
    ).toEqual({
      enabled: true,
      mode: "url",
      baseUrl: "https://opencode.example.com",
      sidecarPort: 4096,
    });
  });

  it("rejects empty URL in url mode validation", () => {
    expect(validateOpencodeBaseUrl("   ")).toContain("required");
  });

  it("rejects unsupported URL protocol", () => {
    expect(validateOpencodeBaseUrl("ws://localhost:4096")).toContain("http:// or https://");
  });

  it("accepts valid https URL", () => {
    expect(validateOpencodeBaseUrl("https://localhost:4096")).toBeNull();
  });

  describe("sidecarPort normalization", () => {
    it("defaults missing sidecarPort to 4096", () => {
      expect(normalizeOpencodeSettings({ mode: "sidecar" }).sidecarPort).toBe(4096);
    });

    it("defaults legacy settings without sidecarPort to 4096", () => {
      expect(
        normalizeOpencodeSettings({ enabled: true, mode: "sidecar", baseUrl: "" }).sidecarPort,
      ).toBe(4096);
    });

    it("rejects non-integer sidecarPort", () => {
      expect(normalizeOpencodeSettings({ sidecarPort: 4096.5 }).sidecarPort).toBe(4096);
      expect(normalizeOpencodeSettings({ sidecarPort: "4096" }).sidecarPort).toBe(4096);
      expect(normalizeOpencodeSettings({ sidecarPort: NaN }).sidecarPort).toBe(4096);
      expect(normalizeOpencodeSettings({ sidecarPort: null }).sidecarPort).toBe(4096);
    });

    it("rejects out-of-range sidecarPort", () => {
      expect(normalizeOpencodeSettings({ sidecarPort: 0 }).sidecarPort).toBe(4096);
      expect(normalizeOpencodeSettings({ sidecarPort: 1023 }).sidecarPort).toBe(4096);
      expect(normalizeOpencodeSettings({ sidecarPort: 65536 }).sidecarPort).toBe(4096);
      expect(normalizeOpencodeSettings({ sidecarPort: -1 }).sidecarPort).toBe(4096);
    });

    it("accepts boundary sidecarPort values", () => {
      expect(normalizeOpencodeSettings({ sidecarPort: 1024 }).sidecarPort).toBe(1024);
      expect(normalizeOpencodeSettings({ sidecarPort: 65535 }).sidecarPort).toBe(65535);
    });

    it("accepts a non-default sidecarPort", () => {
      expect(normalizeOpencodeSettings({ sidecarPort: 54321 }).sidecarPort).toBe(54321);
    });

    it("derives baseUrl from sidecarPort in sidecar mode", () => {
      const settings = normalizeOpencodeSettings({
        enabled: true,
        mode: "sidecar",
        sidecarPort: 54321,
      });
      expect(settings.baseUrl).toBe(`http://${OPENCODE_SIDECAR_HOSTNAME}:54321`);
    });

    it("keeps url-mode baseUrl independent of sidecarPort", () => {
      const settings = normalizeOpencodeSettings({
        enabled: true,
        mode: "url",
        sidecarPort: 54321,
        baseUrl: "https://remote.example.com",
      });
      expect(settings.baseUrl).toBe("https://remote.example.com");
      expect(settings.sidecarPort).toBe(54321);
    });
  });

  describe("validateOpencodeSidecarPort", () => {
    it("accepts 4096", () => {
      expect(validateOpencodeSidecarPort(4096)).toBeNull();
    });

    it("accepts boundary values", () => {
      expect(validateOpencodeSidecarPort(MIN_OPENCODE_SIDECAR_PORT)).toBeNull();
      expect(validateOpencodeSidecarPort(MAX_OPENCODE_SIDECAR_PORT)).toBeNull();
    });

    it("rejects values below 1024", () => {
      expect(validateOpencodeSidecarPort(1023)).toContain("1024");
      expect(validateOpencodeSidecarPort(0)).toContain("1024");
    });

    it("rejects values above 65535", () => {
      expect(validateOpencodeSidecarPort(65536)).toContain("65535");
    });

    it("rejects non-integer values", () => {
      expect(validateOpencodeSidecarPort(4096.5)).toContain("whole number");
      expect(validateOpencodeSidecarPort(Number.NaN)).toContain("whole number");
      expect(validateOpencodeSidecarPort(Number.POSITIVE_INFINITY)).toContain("whole number");
    });
  });

  describe("isOpencodeSidecarPort", () => {
    it("accepts in-range integers", () => {
      expect(isOpencodeSidecarPort(4096)).toBe(true);
      expect(isOpencodeSidecarPort(MIN_OPENCODE_SIDECAR_PORT)).toBe(true);
      expect(isOpencodeSidecarPort(MAX_OPENCODE_SIDECAR_PORT)).toBe(true);
    });

    it("rejects out-of-range and non-integer values", () => {
      expect(isOpencodeSidecarPort(1023)).toBe(false);
      expect(isOpencodeSidecarPort(65536)).toBe(false);
      expect(isOpencodeSidecarPort(4096.5)).toBe(false);
      expect(isOpencodeSidecarPort("4096")).toBe(false);
      expect(isOpencodeSidecarPort(null)).toBe(false);
      expect(isOpencodeSidecarPort(undefined)).toBe(false);
      expect(isOpencodeSidecarPort(Number.NaN)).toBe(false);
    });
  });

  describe("buildOpencodeSidecarBaseUrl", () => {
    it("uses 127.0.0.1 and the supplied port", () => {
      expect(buildOpencodeSidecarBaseUrl(4096)).toBe("http://127.0.0.1:4096");
      expect(buildOpencodeSidecarBaseUrl(54321)).toBe("http://127.0.0.1:54321");
    });
  });

  describe("isOpencodeEnabled", () => {
    it("returns true for default settings", () => {
      expect(isOpencodeEnabled(defaultOpencodeSettings)).toBe(true);
    });

    it("returns false when enabled is false", () => {
      expect(isOpencodeEnabled({ ...defaultOpencodeSettings, enabled: false })).toBe(false);
    });

    it("returns true for null/undefined input", () => {
      expect(isOpencodeEnabled(null)).toBe(true);
      expect(isOpencodeEnabled(undefined)).toBe(true);
    });
  });
});