import type { ChatFilePart, ChatMessage } from "../domain/contracts";

/**
 * Extracted file attachment shown beneath a message.
 *
 * OpenCode emits one `file` part per attachment. We split them into images
 * (rendered inline with click-to-zoom) and other files (rendered as
 * downloadable chips) so the UI can apply the right treatment per mime type.
 *
 * The OpenCode SDK `FilePart` and the SpecOps `ChatFilePart` carry no `size`
 * field, so the chip renders filename only (size is not available on the wire).
 */
export interface MessageAttachment {
  /** Stable id for keyed rendering; falls back to `${messageId}:file:${index}`. */
  id: string;
  mime: string;
  filename?: string;
  url: string;
  /** True when the mime is an image type the UI can render inline. */
  isImage: boolean;
}

const IMAGE_MIME_PREFIX = "image/";
// SVG is technically `image/svg+xml` but we render it inline (it's safe to
// load as an <img> source in our context — the renderer is the sandboxed app).
const IMAGE_MIME_WHITELIST = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/avif",
]);

function isImageMime(mime: string): boolean {
  const normalized = mime.trim().toLowerCase();
  if (IMAGE_MIME_WHITELIST.has(normalized)) {
    return true;
  }
  // Unknown image/* subtypes are treated as images too — the renderer will
  // degrade gracefully if the browser can't decode them.
  return normalized.startsWith(IMAGE_MIME_PREFIX);
}

function isFilePart(part: { type: unknown }): part is ChatFilePart {
  return part.type === "file";
}

/**
 * Returns all file attachments for a message, split into images and other
 * files in arrival order. Drops parts with missing `url` or `mime` (defensive
 * — the codec already enforces these, but the session-messages mapper and
 * local snapshot could disagree). Empty `url` / `mime` are dropped.
 */
export function extractMessageAttachments(message: ChatMessage): {
  images: MessageAttachment[];
  files: MessageAttachment[];
} {
  const parts = message.parts;
  if (!parts || parts.length === 0) {
    return { images: [], files: [] };
  }

  const images: MessageAttachment[] = [];
  const files: MessageAttachment[] = [];
  let fileIndex = 0;
  parts.forEach((part, index) => {
    if (!isFilePart(part)) {
      return;
    }
    const url = part.url.trim();
    const mime = part.mime.trim();
    if (url.length === 0 || mime.length === 0) {
      return;
    }
    const attachment: MessageAttachment = {
      id: part.id && part.id.length > 0 ? part.id : `${message.id}:file:${fileIndex}`,
      mime,
      ...(part.filename && part.filename.trim().length > 0
        ? { filename: part.filename.trim() }
        : {}),
      url,
      isImage: isImageMime(mime),
    };
    fileIndex += 1;
    if (attachment.isImage) {
      images.push(attachment);
    } else {
      files.push(attachment);
    }
  });
  return { images, files };
}

/**
 * Convenience: total attachment count (images + files). Returns 0 when the
 * message carries no file parts. Useful for the renderer to skip the
 * attachments region entirely.
 */
export function countMessageAttachments(message: ChatMessage): number {
  const { images, files } = extractMessageAttachments(message);
  return images.length + files.length;
}
