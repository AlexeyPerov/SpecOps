/**
 * Attachment factory for Markdown preview link clicks.
 * Keeps link handling out of the pane component while preserving status messages.
 */

import type { Attachment } from "svelte/attachments";
import {
  describeMarkdownPreviewLinkResult,
  handleMarkdownPreviewLinkClick,
} from "./markdownPreviewLinks";

export type MarkdownPreviewLinkAttachmentOptions = {
  getDocumentFilePath: () => string | null;
  getWindowId: () => string;
  onStatusMessage?: (message: string) => void;
};

export function markdownPreviewLinkAttachment(
  options: MarkdownPreviewLinkAttachmentOptions,
): Attachment<HTMLElement> {
  return (element) => {
    const onClick = (event: MouseEvent): void => {
      void (async () => {
        const result = await handleMarkdownPreviewLinkClick(event, {
          documentFilePath: options.getDocumentFilePath(),
          windowId: options.getWindowId(),
        });
        if (!result) {
          return;
        }
        const message = describeMarkdownPreviewLinkResult(result);
        if (message) {
          options.onStatusMessage?.(message);
        }
      })();
    };

    element.addEventListener("click", onClick);
    return () => {
      element.removeEventListener("click", onClick);
    };
  };
}
