import { describe, expect, it } from "vitest";
import { tick } from "svelte";
import type { MessageAttachment } from "../ai/chatAttachments";
import ImageAttachment from "./ImageAttachment.svelte";
import { mountComponent } from "./_testComponentMount";

function attachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: "img-1",
    mime: "image/png",
    filename: "screenshot.png",
    url: "file:///tmp/screenshot.png",
    isImage: true,
    ...overrides,
  };
}

async function openOverlay(host: HTMLElement): Promise<void> {
  host.querySelector<HTMLButtonElement>(".image-attachment-thumb")?.click();
  // Svelte 5 batches DOM updates into a microtask; flush before asserting.
  await tick();
}

describe("ImageAttachment.svelte", () => {
  it("renders a figure with a thumbnail image and caption", () => {
    const { host } = mountComponent(ImageAttachment, {
      attachment: attachment(),
    });
    expect(host.querySelector("figure.image-attachment")).not.toBeNull();
    const img = host.querySelector<HTMLImageElement>(".image-attachment-img");
    expect(img?.getAttribute("src")).toBe("file:///tmp/screenshot.png");
    expect(img?.getAttribute("alt")).toBe("screenshot.png");
    expect(host.querySelector(".image-attachment-name")?.textContent).toBe("screenshot.png");
    expect(host.querySelector(".image-attachment-zoom-hint")?.textContent).toContain("zoom");
  });

  it("uses a generic alt label when no filename is set", () => {
    const { host } = mountComponent(ImageAttachment, {
      attachment: attachment({ filename: undefined }),
    });
    const img = host.querySelector<HTMLImageElement>(".image-attachment-img");
    expect(img?.getAttribute("alt")).toBe("Image");
    // No filename means no name caption; the zoom hint is still present.
    expect(host.querySelector(".image-attachment-name")).toBeNull();
  });

  it("opens the zoom overlay when the thumbnail is clicked", async () => {
    const { host } = mountComponent(ImageAttachment, {
      attachment: attachment(),
    });
    expect(host.querySelector(".image-attachment-overlay")).toBeNull();
    await openOverlay(host);
    const overlay = host.querySelector(".image-attachment-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute("role")).toBe("dialog");
    expect(overlay?.getAttribute("aria-modal")).toBe("true");
    expect(host.querySelector(".image-attachment-full")?.getAttribute("src")).toBe(
      "file:///tmp/screenshot.png",
    );
  });

  it("closes the overlay when the close button is clicked", async () => {
    const { host } = mountComponent(ImageAttachment, {
      attachment: attachment(),
    });
    await openOverlay(host);
    expect(host.querySelector(".image-attachment-overlay")).not.toBeNull();
    host.querySelector<HTMLButtonElement>(".image-attachment-close")?.click();
    await tick();
    expect(host.querySelector(".image-attachment-overlay")).toBeNull();
  });

  it("closes the overlay when the backdrop is clicked", async () => {
    const { host } = mountComponent(ImageAttachment, {
      attachment: attachment(),
    });
    await openOverlay(host);
    const overlay = host.querySelector<HTMLElement>(".image-attachment-overlay");
    overlay?.click();
    await tick();
    expect(host.querySelector(".image-attachment-overlay")).toBeNull();
  });

  it("closes the overlay on Escape via the global window listener", async () => {
    const { host } = mountComponent(ImageAttachment, {
      attachment: attachment(),
    });
    await openOverlay(host);
    expect(host.querySelector(".image-attachment-overlay")).not.toBeNull();
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    window.dispatchEvent(event);
    await tick();
    expect(host.querySelector(".image-attachment-overlay")).toBeNull();
  });

  it("does not close the overlay when the full image is clicked (stopPropagation)", async () => {
    const { host } = mountComponent(ImageAttachment, {
      attachment: attachment(),
    });
    await openOverlay(host);
    const full = host.querySelector<HTMLImageElement>(".image-attachment-full");
    full?.click();
    await tick();
    expect(host.querySelector(".image-attachment-overlay")).not.toBeNull();
  });

  it("ignores Escape while the overlay is closed (no global keydown listener active)", () => {
    const { host } = mountComponent(ImageAttachment, {
      attachment: attachment(),
    });
    // Overlay not opened; dispatching Escape should be a no-op (no throw).
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    expect(() => window.dispatchEvent(event)).not.toThrow();
    expect(host.querySelector(".image-attachment-overlay")).toBeNull();
  });
});
