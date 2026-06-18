import type { AppDomainState, FontSettings } from "../../domain/contracts";
import { fontScaleToPx } from "../../services/fontSettings";
import type { SettingsUpdate } from "./logSettingsSlice";

/**
 * Writes the three font-size CSS variables onto the document root so the body
 * (`--font-size-ui`), editor (`--font-size-editor`), and chat prose
 * (`--font-size-chat`) reflow. No-op outside a DOM (tests).
 */
export function applyFontSettingsToDom(settings: FontSettings): void {
  if (typeof document === "undefined" || !document.documentElement) {
    return;
  }
  const root = document.documentElement;
  root.style.setProperty("--font-size-ui", `${fontScaleToPx(settings.uiScale)}px`);
  root.style.setProperty("--font-size-editor", `${fontScaleToPx(settings.editorScale)}px`);
  root.style.setProperty("--font-size-chat", `${fontScaleToPx(settings.chatScale)}px`);
}

export function createFontSettingsSlice(update: SettingsUpdate) {
  return {
    setFontSettings(patch: Partial<FontSettings>) {
      update((state) => {
        const fontSettings: FontSettings = {
          ...state.settings.fontSettings,
          ...patch,
        };
        applyFontSettingsToDom(fontSettings);
        return {
          ...state,
          settings: {
            ...state.settings,
            fontSettings,
          },
        };
      });
    },
  };
}
