/**
 * Local-image blob fallbacks for Markdown preview panes.
 * Owns object-URL lifetime with generation guards so stale async work cannot
 * attach handlers or blob URLs to a newer document/mode.
 */

import { readFile } from "@tauri-apps/plugin-fs";
import { mimeTypeForImagePath } from "./imagePreviewSrc";
import { emptySet, emptyWeakSet } from "../collections/emptyCollections";

export type MarkdownPreviewImageFallbackController = {
  /**
   * Wire error→blob fallbacks onto `img[data-md-local-path]` inside the given
   * panes. Bumps generation and revokes prior blob URLs.
   */
  wire: (panes: Array<HTMLElement | null | undefined>) => Promise<void>;
  /** Revoke all owned blob URLs and invalidate in-flight work. */
  dispose: () => void;
};

export type MarkdownPreviewImageFallbackDeps = {
  readFileBytes?: (path: string) => Promise<Uint8Array>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  waitForLayout?: () => Promise<void>;
};

export function createMarkdownPreviewImageFallbacks(
  deps: MarkdownPreviewImageFallbackDeps = {},
): MarkdownPreviewImageFallbackController {
  const readFileBytes = deps.readFileBytes ?? ((path) => readFile(path));
  const createObjectUrl = deps.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
  const revokeObjectUrl = deps.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));

  let generation = 0;
  const ownedUrls = emptySet<string>();

  function revokeAll(): void {
    for (const url of ownedUrls) {
      revokeObjectUrl(url);
    }
    ownedUrls.clear();
  }

  function dispose(): void {
    generation += 1;
    revokeAll();
  }

  async function loadBlobFallback(
    img: HTMLImageElement,
    localPath: string,
    wireGeneration: number,
  ): Promise<void> {
    if (wireGeneration !== generation) {
      return;
    }
    if (img.src.startsWith("blob:")) {
      return;
    }
    try {
      const bytes = await readFileBytes(localPath);
      if (wireGeneration !== generation) {
        return;
      }
      const url = createObjectUrl(
        new Blob([bytes], { type: mimeTypeForImagePath(localPath) }),
      );
      ownedUrls.add(url);
      img.src = url;
    } catch {
      // Leave the broken asset-protocol src; nothing more we can do.
    }
  }

  function attachImageFallback(
    img: HTMLImageElement,
    wireGeneration: number,
  ): void {
    const localPath = img.getAttribute("data-md-local-path");
    if (!localPath || img.dataset.mdFallbackWired === "1") {
      return;
    }
    img.dataset.mdFallbackWired = "1";
    img.addEventListener("error", () => {
      void loadBlobFallback(img, localPath, wireGeneration);
    });
  }

  async function wire(panes: Array<HTMLElement | null | undefined>): Promise<void> {
    const wireGeneration = ++generation;
    revokeAll();

    if (deps.waitForLayout) {
      await deps.waitForLayout();
    }
    if (wireGeneration !== generation) {
      return;
    }

    const handled = emptyWeakSet<HTMLImageElement>();
    for (const pane of panes) {
      if (!pane) {
        continue;
      }
      for (const img of pane.querySelectorAll<HTMLImageElement>("img[data-md-local-path]")) {
        if (handled.has(img)) {
          continue;
        }
        handled.add(img);
        attachImageFallback(img, wireGeneration);
      }
    }
  }

  return { wire, dispose };
}
