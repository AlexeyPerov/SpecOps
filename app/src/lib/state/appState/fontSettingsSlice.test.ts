import { afterEach, describe, expect, it } from "vitest";
import type { FontSettings } from "../../domain/contracts";
import { FONT_BASE_PX } from "../../services/fontSettings";
import { applyFontSettingsToDom, createFontSettingsSlice } from "./fontSettingsSlice";

function readVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

afterEach(() => {
  document.documentElement.style.cssText = "";
});

describe("applyFontSettingsToDom", () => {
  it("writes the three font-size CSS variables scaled from the 13px base", () => {
    const settings: FontSettings = {
      uiScale: 120,
      editorScale: 150,
      chatScale: 90,
    };
    applyFontSettingsToDom(settings);

    expect(readVar("--font-size-ui")).toBe(
      `${Math.round((FONT_BASE_PX * 120) / 100)}px`,
    );
    expect(readVar("--font-size-editor")).toBe(
      `${Math.round((FONT_BASE_PX * 150) / 100)}px`,
    );
    expect(readVar("--font-size-chat")).toBe(
      `${Math.round((FONT_BASE_PX * 90) / 100)}px`,
    );
  });

  it("defaults (100%) reproduce the 13px base", () => {
    applyFontSettingsToDom({ uiScale: 100, editorScale: 100, chatScale: 100 });
    expect(readVar("--font-size-editor")).toBe("13px");
  });
});

describe("createFontSettingsSlice.setFontSettings", () => {
  it("updates state and applies the new sizes to the DOM", () => {
    const stateRef: { settings: { fontSettings: FontSettings } } = {
      settings: { fontSettings: { uiScale: 100, editorScale: 100, chatScale: 100 } },
    };
    const update = (mutator: (s: typeof stateRef) => typeof stateRef) => {
      stateRef.settings = mutator(stateRef).settings;
    };

    const slice = createFontSettingsSlice(update as never);
    slice.setFontSettings({ editorScale: 140 });

    expect(stateRef.settings.fontSettings.editorScale).toBe(140);
    expect(readVar("--font-size-editor")).toBe(
      `${Math.round((FONT_BASE_PX * 140) / 100)}px`,
    );
  });
});
