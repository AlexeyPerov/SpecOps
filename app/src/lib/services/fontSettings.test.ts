import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_SCALE,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  defaultFontSettings,
  fontScaleToPx,
  normalizeFontScale,
  normalizeFontSettings,
} from "./fontSettings";
import {
  defaultPersistedSettings,
  loadPersistedSettings,
  toExternalFilesSettings,
  toPersistedSettings,
} from "./settingsStore";

describe("defaultFontSettings", () => {
  it("uses 100% for all three surfaces (preserves the pre-M6 13px base)", () => {
    expect(defaultFontSettings).toEqual({
      uiScale: 100,
      editorScale: 100,
      chatScale: 100,
    });
  });
});

describe("normalizeFontScale", () => {
  it("passes through valid percentages within range", () => {
    expect(normalizeFontScale(80)).toBe(80);
    expect(normalizeFontScale(FONT_SCALE_MIN)).toBe(FONT_SCALE_MIN);
    expect(normalizeFontScale(FONT_SCALE_MAX)).toBe(FONT_SCALE_MAX);
  });

  it("rounds non-integer scales", () => {
    expect(normalizeFontScale(80.4)).toBe(80);
    expect(normalizeFontScale(80.6)).toBe(81);
  });

  it("falls back to default when below the minimum", () => {
    expect(normalizeFontScale(FONT_SCALE_MIN - 1)).toBe(DEFAULT_FONT_SCALE);
  });

  it("falls back to default when above the maximum", () => {
    expect(normalizeFontScale(FONT_SCALE_MAX + 1)).toBe(DEFAULT_FONT_SCALE);
  });

  it("falls back to default for non-numeric input", () => {
    expect(normalizeFontScale("big" as unknown as number)).toBe(DEFAULT_FONT_SCALE);
    expect(normalizeFontScale(NaN)).toBe(DEFAULT_FONT_SCALE);
    expect(normalizeFontScale(null)).toBe(DEFAULT_FONT_SCALE);
    expect(normalizeFontScale(undefined)).toBe(DEFAULT_FONT_SCALE);
  });
});

describe("normalizeFontSettings", () => {
  it("returns defaults for non-object input", () => {
    expect(normalizeFontSettings(null)).toEqual(defaultFontSettings);
    expect(normalizeFontSettings("nope")).toEqual(defaultFontSettings);
    expect(normalizeFontSettings(undefined)).toEqual(defaultFontSettings);
  });

  it("preserves valid scales and fills missing fields with defaults", () => {
    expect(
      normalizeFontSettings({ uiScale: 120, editorScale: 90 }),
    ).toEqual({
      uiScale: 120,
      editorScale: 90,
      chatScale: DEFAULT_FONT_SCALE,
    });
  });

  it("clamps out-of-range values back to the default", () => {
    expect(
      normalizeFontSettings({ uiScale: 500, editorScale: 10, chatScale: 100 }),
    ).toEqual({
      uiScale: DEFAULT_FONT_SCALE,
      editorScale: DEFAULT_FONT_SCALE,
      chatScale: 100,
    });
  });
});

describe("fontScaleToPx", () => {
  it("computes the pixel size from the 13px base", () => {
    expect(fontScaleToPx(100)).toBe(13);
    expect(fontScaleToPx(200)).toBe(26);
    expect(fontScaleToPx(150)).toBe(20); // 19.5 rounded
  });
});

describe("font settings persistence round-trip", () => {
  it("round-trips through toPersistedSettings / normalizeFontSettings", () => {
    const custom = { uiScale: 110, editorScale: 130, chatScale: 95 };
    const persisted = toPersistedSettings({
      ...defaultPersistedSettings,
      externalFiles: toExternalFilesSettings(defaultPersistedSettings),
      fontSettings: custom,
    });
    expect(persisted.fontSettings).toEqual(custom);

    // Re-normalizing a serialized blob should be lossless.
    expect(normalizeFontSettings(JSON.parse(JSON.stringify(custom)))).toEqual(
      custom,
    );
  });

  it("loadPersistedSettings returns null when settings.json is absent", async () => {
    expect(await loadPersistedSettings()).toBeNull();
  });
});
