import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createRawSnippet, flushSync } from "svelte";
import GitWorkspaceSplit from "./GitWorkspaceSplit.svelte";
import { mountComponent } from "./_testComponentMount";

let width = 1000;
let height = 700;
const observers = new Set<() => void>();
const content = createRawSnippet(() => ({ render: () => "<span>Panel content</span>" }));
function setup(storageKey = "layout:main:workspace-a", options = {}) {
  const mounted = mountComponent(GitWorkspaceSplit, { storageKey, label: "Resize panels", first: content, second: content, ...options });
  flushSync();
  const handle = mounted.host.querySelector<HTMLElement>('[role="separator"]')!;
  return { ...mounted, handle, value: () => Number(handle.getAttribute("aria-valuenow")) };
}
function key(handle: HTMLElement, key: string) {
  handle.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  flushSync();
}
function pointer(target: EventTarget, type: string, clientX: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, clientX, button: 0 });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  target.dispatchEvent(event);
  flushSync();
}
beforeEach(() => {
  width = 1000; height = 700;
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => height);
  vi.stubGlobal("ResizeObserver", class {
    callback: () => void;
    constructor(callback: () => void) { this.callback = callback; }
    observe() { observers.add(this.callback); }
    disconnect() { observers.delete(this.callback); }
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); observers.clear(); });

describe("workspace split layout", () => {
  it("resizes by keyboard and restores its proportion after remount, isolated by workspace and window", () => {
    const first = setup();
    key(first.handle, "ArrowRight");
    const chosen = first.value();
    first.unmount();
    expect(setup().value()).toBe(chosen);
    expect(setup("layout:main:workspace-b").value()).toBeLessThan(chosen);
    expect(setup("layout:second:workspace-a").value()).toBeLessThan(chosen);
  });
  it("clamps at available size on resize without overwriting the preferred proportion", () => {
    const view = setup();
    key(view.handle, "End");
    const chosen = view.value();
    width = 190;
    for (const callback of observers) callback();
    flushSync();
    expect(view.value()).toBeGreaterThanOrEqual(0);
    expect(view.value()).toBeLessThan(190);
    width = 1000;
    for (const callback of observers) callback();
    flushSync();
    expect(view.value()).toBe(chosen);
  });
  it("supports vertical keyboard resizing and resetting defaults", () => {
    const view = setup("vertical", { vertical: true, initial: 0.4 });
    const original = view.value();
    expect(view.handle.getAttribute("aria-orientation")).toBe("horizontal");
    key(view.handle, "ArrowDown");
    expect(view.value()).toBe(original + 10);
    key(view.handle, "Home");
    expect(view.value()).toBe(original);
    key(view.handle, "ArrowUp");
    view.handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    flushSync();
    expect(view.value()).toBe(original);
  });
  it.each(["pointerup", "pointercancel"])("ends a drag on %s and ignores other pointers", (ending) => {
    const view = setup();
    const before = view.value();
    pointer(view.handle, "pointerdown", 200);
    pointer(window, "pointermove", 240, 2);
    expect(view.value()).toBe(before);
    pointer(window, "pointermove", 240);
    expect(view.value()).toBe(before + 40);
    pointer(window, ending, 240);
    pointer(window, "pointermove", 400);
    expect(view.value()).toBe(before + 40);
  });
  it("cleans up resizing when unmounted mid-drag", () => {
    const view = setup();
    pointer(view.handle, "pointerdown", 200);
    view.unmount(); flushSync();
    const saved = localStorage.getItem("layout:main:workspace-a");
    pointer(window, "pointermove", 500);
    expect(localStorage.getItem("layout:main:workspace-a")).toBe(saved);
  });
  it("hides a collapsed pane and separator while keeping the other panel accessible", () => {
    const view = setup("collapsed", { collapsed: true, collapseSecond: true });
    const panes = view.host.querySelectorAll<HTMLElement>(".workspace-split-pane");
    expect(panes[0].hidden).toBe(false);
    expect(panes[1].hidden).toBe(true);
    expect(view.handle.hidden).toBe(true);
    expect(view.handle.tabIndex).toBe(-1);
  });
  it("ignores invalid saved layout data", () => {
    localStorage.setItem("invalid", '"broken"');
    expect(setup("invalid").value()).toBe(setup("default").value());
  });
});
