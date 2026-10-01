import { flushSync } from "svelte";
import { beforeEach, describe, expect, it } from "vitest";
import { appState } from "../state/appState";
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
