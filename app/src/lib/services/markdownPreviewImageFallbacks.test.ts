import { describe, expect, it, vi } from "vitest";
import { createMarkdownPreviewImageFallbacks } from "./markdownPreviewImageFallbacks";

function makeImg(localPath: string): HTMLImageElement {
  const img = document.createElement("img");
  img.setAttribute("data-md-local-path", localPath);
  img.src = "asset://broken";
  return img;
}

describe("createMarkdownPreviewImageFallbacks", () => {
  it("revokes prior blob URLs when rewiring", async () => {
    const revokeObjectUrl = vi.fn();
    const createObjectUrl = vi.fn(() => "blob:test-1");
    const readFileBytes = vi.fn(async () => new Uint8Array([1, 2, 3]));

    const controller = createMarkdownPreviewImageFallbacks({
      readFileBytes,
      createObjectUrl,
      revokeObjectUrl,
      waitForLayout: async () => {},
    });

    const pane = document.createElement("div");
    const img = makeImg("/tmp/a.png");
    pane.appendChild(img);

    await controller.wire([pane]);
    img.dispatchEvent(new Event("error"));
    await Promise.resolve();
    await Promise.resolve();

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(img.src).toBe("blob:test-1");

    await controller.wire([pane]);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:test-1");

    controller.dispose();
  });

  it("ignores stale async fallback after dispose", async () => {
    let release!: () => void;
    const pending = new Promise<Uint8Array>((resolve) => {
      release = () => resolve(new Uint8Array([9]));
    });
    const createObjectUrl = vi.fn(() => "blob:stale");
    const controller = createMarkdownPreviewImageFallbacks({
      readFileBytes: () => pending,
      createObjectUrl,
      waitForLayout: async () => {},
    });

    const pane = document.createElement("div");
    const img = makeImg("/tmp/b.png");
    pane.appendChild(img);

    await controller.wire([pane]);
    img.dispatchEvent(new Event("error"));
    controller.dispose();
    release();
    await pending;
    await Promise.resolve();

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(img.src).toContain("asset://broken");
  });

  it("does not attach duplicate listeners on the same image within one wire", async () => {
    const controller = createMarkdownPreviewImageFallbacks({
      waitForLayout: async () => {},
    });
    const pane = document.createElement("div");
    const img = makeImg("/tmp/c.png");
    pane.appendChild(img);

    await controller.wire([pane, pane]);
    expect(img.dataset.mdFallbackWired).toBe("1");
    controller.dispose();
  });
});
