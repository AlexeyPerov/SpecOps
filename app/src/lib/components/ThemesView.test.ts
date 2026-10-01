import { flushSync } from "svelte";
import { beforeEach, describe, expect, it } from "vitest";
import { appState } from "../state/appState";
import { resolveBuiltinTokens } from "../styles/themeTokens";
import ThemesView from "./ThemesView.svelte";
import { mountComponent } from "./_testComponentMount";

describe("file icon appearance picker", () => {
  beforeEach(() => appState.resetAppState());

  it("switches the shared appearance preference while previewing both choices", () => {
    const { host } = mountComponent(ThemesView, {});
    flushSync();
    const choices = host.querySelectorAll<HTMLInputElement>('input[name="file-icons"]');
    expect(choices).toHaveLength(2);
    expect(choices[0].checked).toBe(true);
    expect(host.querySelectorAll(".file-icon-samples .monochrome")).toHaveLength(6);
    choices[1].click();
    flushSync();
    expect(appState.getSnapshot().settings.coloredProjectFileIcons).toBe(false);
    expect(choices[1].checked).toBe(true);
    choices[0].click();
    flushSync();
    expect(appState.getSnapshot().settings.coloredProjectFileIcons).toBe(true);
  });
});

describe("theme preview grid", () => {
  beforeEach(() => appState.resetAppState());

  it("selects a manual theme without borrowing the current palette", () => {
    appState.setThemeMode("manual");
    const { host } = mountComponent(ThemesView, {});
    flushSync();
    const light = host.querySelector<HTMLInputElement>('input[value="builtin:light-blue"]')!;
    const card = light.closest<HTMLElement>(".theme-card")!;
    const preview = card.querySelector<HTMLElement>(".theme-preview")!;
    expect(preview.style.getPropertyValue("--preview-color-bg-root")).toBeTruthy();
    expect(preview.style.getPropertyValue("--preview-color-bg-root")).toBe(resolveBuiltinTokens("light-blue")["color-bg-root"]);
    light.click();
    flushSync();
    expect(appState.getSnapshot().theme.manualTheme).toEqual({ kind: "builtin", id: "light-blue" });
    expect(card.classList.contains("selected")).toBe(true);
    expect(card.querySelector(".check")?.textContent).toBe("✓");
  });

  it("keeps independent light and dark choices in auto mode", () => {
    appState.setThemeMode("auto");
    const { host } = mountComponent(ThemesView, {});
    flushSync();
    const lightChoices = host.querySelectorAll<HTMLInputElement>('input[name="light-theme"]');
    const darkChoices = host.querySelectorAll<HTMLInputElement>('input[name="dark-theme"]');
    expect(lightChoices.length).toBeGreaterThan(0);
    expect(darkChoices.length).toBeGreaterThan(0);
    for (const choice of lightChoices) expect(choice.closest(".theme-card")?.querySelector(".theme-preview")?.getAttribute("data-mode")).toBe("light");
    for (const choice of darkChoices) expect(choice.closest(".theme-card")?.querySelector(".theme-preview")?.getAttribute("data-mode")).toBe("dark");
    const lightBefore = appState.getSnapshot().theme.lightTheme;
    const choice = darkChoices[1];
    choice.click();
    flushSync();
    expect(appState.getSnapshot().theme.darkTheme.id).toBe(choice.value.split(":")[1]);
    expect(appState.getSnapshot().theme.lightTheme).toEqual(lightBefore);
  });

  it("duplicates separately from selection and updates custom gradient previews", () => {
    appState.setThemeMode("manual");
    const { host } = mountComponent(ThemesView, {});
    flushSync();
    const light = host.querySelector('[data-theme-ref="builtin:light-blue"]')!;
    const selectionBefore = appState.getSnapshot().theme.manualTheme;
    light.querySelector<HTMLButtonElement>("button")!.click();
    flushSync();
    const custom = appState.getSnapshot().theme.customThemes[0];
    expect(custom.baseMode).toBe("light");
    expect(appState.getSnapshot().theme.manualTheme).toEqual(selectionBefore);
    appState.updateCustomThemeToken(custom.id, "color-hover", "color-mix(in srgb, var(--accent-color) 18%, var(--color-bg-root))");
    appState.updateCustomThemeToken(custom.id, "color-bg-root", "linear-gradient(#123456, #abcdef)");
    flushSync();
    const preview = host.querySelector<HTMLElement>(`[data-theme-ref="custom:${custom.id}"] .theme-preview`)!;
    expect(preview.style.getPropertyValue("--preview-color-bg-root")).toBe("linear-gradient(#123456, #abcdef)");
    expect(preview.style.getPropertyValue("--preview-color-bg-root-solid")).toBe("#123456");
    expect(preview.style.getPropertyValue("--preview-color-hover")).toContain("var(--preview-color-bg-root-solid)");
  });
});
