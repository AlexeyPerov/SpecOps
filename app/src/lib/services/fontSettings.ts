import type { FontSettings } from "../domain/contracts";

/** 13px is the pre-M6 base for all three surfaces; 100% preserves it. */
export const FONT_BASE_PX = 13;
export const FONT_SCALE_MIN = 60;
export const FONT_SCALE_MAX = 200;
export const DEFAULT_FONT_SCALE = 100;

export const defaultFontSettings: FontSettings = {
  uiScale: DEFAULT_FONT_SCALE,
  editorScale: DEFAULT_FONT_SCALE,
  chatScale: DEFAULT_FONT_SCALE,
};

/** Clamps a scale percentage to the supported range, falling back to default. */
export function normalizeFontScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_FONT_SCALE;
  }
  const rounded = Math.round(value);
  if (rounded < FONT_SCALE_MIN || rounded > FONT_SCALE_MAX) {
    return DEFAULT_FONT_SCALE;
  }
  return rounded;
}

/** Converts a scale percentage to a CSS px value against the 13px base. */
export function fontScaleToPx(scale: number): number {
  return Math.round((FONT_BASE_PX * scale) / 100);
}

/** Validates and normalizes persisted font settings. */
export function normalizeFontSettings(value: unknown): FontSettings {
  if (typeof value !== "object" || value === null) {
    return { ...defaultFontSettings };
  }
  const record = value as Record<string, unknown>;
  return {
    uiScale: normalizeFontScale(record.uiScale),
    editorScale: normalizeFontScale(record.editorScale),
    chatScale: normalizeFontScale(record.chatScale),
  };
}
