import { describe, expect, it, vi } from "vitest";
import {
  createMarkdownSplitScrollSync,
  syncMarkdownSplitScrollByRatio,
} from "./markdownSplitScrollSync";

describe("syncMarkdownSplitScrollByRatio", () => {
  it("maps source scroll ratio onto the target", () => {
    const source = {
      scrollHeight: 200,
      clientHeight: 100,
      scrollTop: 50,
    } as HTMLElement;
    const target = {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 0,
    } as HTMLElement;

    syncMarkdownSplitScrollByRatio(source, target);
    expect(target.scrollTop).toBe(150);
  });

  it("resets target scroll when either side is not scrollable", () => {
    const source = {
      scrollHeight: 100,
      clientHeight: 100,
      scrollTop: 0,
    } as HTMLElement;
    const target = {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 80,
    } as HTMLElement;

    syncMarkdownSplitScrollByRatio(source, target);
    expect(target.scrollTop).toBe(0);
  });
});

describe("createMarkdownSplitScrollSync", () => {
  it("ignores stale setup after dispose during waitForLayout", async () => {
    const editorRoot = document.createElement("div");
    const scroller = document.createElement("div");
    scroller.className = "cm-scroller";
    editorRoot.appendChild(scroller);
    const preview = document.createElement("div");
    const addSpy = vi.spyOn(scroller, "addEventListener");

    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });

    const handle = createMarkdownSplitScrollSync({
      getEditorRoot: () => editorRoot,
      getPreviewScroller: () => preview,
      waitForLayout: () => wait,
    });

    handle.dispose();
    release();
    await wait;
    await Promise.resolve();

    expect(addSpy).not.toHaveBeenCalled();
    addSpy.mockRestore();
  });

  it("attaches trusted scroll listeners when layout is ready", async () => {
    const editorRoot = document.createElement("div");
    const scroller = document.createElement("div");
    scroller.className = "cm-scroller";
    Object.defineProperties(scroller, {
      scrollHeight: { value: 200 },
      clientHeight: { value: 100 },
      scrollTop: { value: 50, writable: true },
    });
    editorRoot.appendChild(scroller);

    const preview = document.createElement("div");
    Object.defineProperties(preview, {
      scrollHeight: { value: 400 },
      clientHeight: { value: 100 },
      scrollTop: { value: 0, writable: true },
    });

    const handle = createMarkdownSplitScrollSync({
      getEditorRoot: () => editorRoot,
      getPreviewScroller: () => preview,
      waitForLayout: async () => {},
    });

    await Promise.resolve();
    expect(preview.scrollTop).toBe(150);

    handle.dispose();
  });

  it("removes listeners on dispose", async () => {
    const removeSpy = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    const editorRoot = document.createElement("div");
    const scroller = document.createElement("div");
    scroller.className = "cm-scroller";
    Object.defineProperties(scroller, {
      scrollHeight: { value: 200 },
      clientHeight: { value: 100 },
      scrollTop: { value: 0, writable: true },
    });
    editorRoot.appendChild(scroller);
    const preview = document.createElement("div");
    Object.defineProperties(preview, {
      scrollHeight: { value: 200 },
      clientHeight: { value: 100 },
      scrollTop: { value: 0, writable: true },
    });

    const handle = createMarkdownSplitScrollSync({
      getEditorRoot: () => editorRoot,
      getPreviewScroller: () => preview,
      waitForLayout: async () => {},
    });
    await Promise.resolve();
    handle.dispose();

    expect(removeSpy).toHaveBeenCalled();
    removeSpy.mockRestore();
  });
});
