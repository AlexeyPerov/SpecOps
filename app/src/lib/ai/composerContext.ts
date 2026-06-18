import type {
  WorkspaceAgentSendAttachment,
  WorkspaceAgentSendContext,
} from "./backends/workspaceAgentBackend";
import type { MentionToken } from "./backends/opencodeSearch";

/**
 * Pure helpers for assembling the composer's per-send context payload (M3).
 *
 * The composer keeps a draft string plus a list of mention tokens and an
 * attachment tray. On send these are merged into a single
 * `WorkspaceAgentSendContext` that flows through `chatSendPipeline` →
 * `backend.send` → the OpenCode prompt `parts`.
 *
 * Mention tokens encode the kind (`@file:` / `@agent:`) so the assembler can
 * route each mention to the right context field.
 */

/** A single file attachment held in the composer tray before send. */
export interface ComposerAttachment {
  /** Stable id for keyed rendering / chip removal. */
  id: string;
  filename: string;
  mime: string;
  /** Object URL or absolute file URL — forwarded to OpenCode as the `url`. */
  url: string;
  /** `true` for image mimes so the tray renders a thumbnail. */
  isImage: boolean;
  /** Original size in bytes when known (for display only). */
  sizeBytes?: number;
}

const IMAGE_MIME_PREFIX = "image/";
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

export function isImageMime(mime: string): boolean {
  const normalized = mime.trim().toLowerCase();
  if (IMAGE_MIME_WHITELIST.has(normalized)) {
    return true;
  }
  return normalized.startsWith(IMAGE_MIME_PREFIX);
}

/** Infers a mime from a `File.type` / extension. Falls back to
 * `application/octet-stream` so OpenCode always gets a non-empty `mime`. */
export function inferAttachmentMime(file: { type?: string; name?: string }): string {
  const trimmed = (file.type ?? "").trim().toLowerCase();
  if (trimmed.length > 0) {
    return trimmed;
  }
  const ext = (file.name ?? "").toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "webm":
      return "video/webm";
    case "mp4":
      return "video/mp4";
    case "pdf":
      return "application/pdf";
    case "json":
      return "application/json";
    case "txt":
    case "md":
      return "text/plain";
    case "html":
      return "text/html";
    case "csv":
      return "text/csv";
    case "zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

/**
 * Assembles the send context from mention tokens + attachments. Returns
 * `undefined` when nothing is attached so the pipeline can skip the
 * `context` field entirely (no `parts` appended).
 */
export function buildSendContext(input: {
  mentions: readonly MentionToken[];
  attachments: readonly ComposerAttachment[];
}): WorkspaceAgentSendContext | undefined {
  const mentions = input.mentions;
  const attachments = input.attachments;
  const filePaths: string[] = [];
  const agentNames: string[] = [];
  for (const mention of mentions) {
    const value = mention.value.trim();
    if (value.length === 0) {
      continue;
    }
    if (mention.kind === "file") {
      filePaths.push(value);
    } else {
      agentNames.push(value);
    }
  }
  const sendAttachments: WorkspaceAgentSendAttachment[] = attachments
    .filter((attachment) => attachment.url.trim().length > 0 && attachment.mime.trim().length > 0)
    .map((attachment) => ({
      mime: attachment.mime.trim(),
      ...(attachment.filename.trim().length > 0
        ? { filename: attachment.filename.trim() }
        : {}),
      url: attachment.url.trim(),
    }));

  if (filePaths.length === 0 && agentNames.length === 0 && sendAttachments.length === 0) {
    return undefined;
  }
  const context: WorkspaceAgentSendContext = {};
  if (filePaths.length > 0) {
    context.filePaths = filePaths;
  }
  if (agentNames.length > 0) {
    context.agentNames = agentNames;
  }
  if (sendAttachments.length > 0) {
    context.attachments = sendAttachments;
  }
  return context;
}

/** Parses the file path out of a `@file:…` display token, or returns `null`. */
export function parseFilePathToken(display: string): string | null {
  const trimmed = display.trim();
  if (!trimmed.startsWith("@file:")) {
    return null;
  }
  const value = trimmed.slice("@file:".length).trim();
  return value.length > 0 ? value : null;
}

/** Parses the agent id out of an `@agent:…` display token, or returns `null`. */
export function parseAgentToken(display: string): string | null {
  const trimmed = display.trim();
  if (!trimmed.startsWith("@agent:")) {
    return null;
  }
  const value = trimmed.slice("@agent:".length).trim();
  return value.length > 0 ? value : null;
}
