import { afterEach, describe, expect, it, vi } from "vitest";
import { SvelteMap } from "svelte/reactivity";
import { flushSync } from "svelte";
import HtmlPreviewPane from "./HtmlPreviewPane.svelte";
import { mountComponent } from "./_testComponentMount";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => `https://asset.localhost${p}` }));
afterEach(() => vi.useRealTimers());

describe("HtmlPreviewPane", () => {
  it("renders HTML in a sandbox that cannot run scripts or open popups", async () => {
    vi.useFakeTimers();
    const { host } = mountComponent(HtmlPreviewPane, {
      content: '<style>body{color:red}</style><h1>Gallery</h1>', filePath: '/tmp/gallery.html', windowId: "main", notify: vi.fn(),
    });
    flushSync();
    await vi.advanceTimersByTimeAsync(120);
    flushSync();
    const frame = host.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame.srcdoc).toContain("<h1>Gallery</h1>");
    expect(frame.srcdoc).toContain("<style>body{color:red}</style>");
  });
  it("updates changed buffers after a debounce and cancels work on close", async () => {
    vi.useFakeTimers();
    const source = new SvelteMap([["content", "<h1>Before</h1>"]]);
    const { host, unmount } = mountComponent(HtmlPreviewPane, {
      get content() { return source.get("content")!; },
      filePath: "/tmp/page.html", windowId: "main", notify: vi.fn(),
    });
    flushSync();
    await vi.advanceTimersByTimeAsync(120);
    flushSync();
    const frame = host.querySelector("iframe")!;
    source.set("content", "<h1>After</h1>");
    flushSync();
    expect(frame.srcdoc).toContain("Before");
    await vi.advanceTimersByTimeAsync(120);
    flushSync();
    expect(frame.srcdoc).toContain("After");
    source.set("content", "<h1>Cancelled</h1>");
    flushSync();
    unmount();
    flushSync();
    await vi.advanceTimersByTimeAsync(120);
    expect(frame.srcdoc).toContain("After");
  });

});
