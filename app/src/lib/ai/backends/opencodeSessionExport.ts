import type { ChatMessage } from "../../domain/contracts";

/**
 * Serializes a SpecOps workspace-agent transcript into a standalone Markdown
 * file (M2-T7 export). The format mirrors how OpenCode Desktop exports a
 * session: a front-matter header (title / source / exported-at / message
 * count), then one section per message with role + timestamp + content and
 * any tool calls folded in as fenced blocks.
 *
 * Pure and synchronous — the only side effect is the returned string. The
 * caller (`workspace.ts` handler) is responsible for piping it through the
 * Tauri save-file dialog.
 */

export interface ExportTranscriptInput {
  title: string;
  /** Workspace root path the session belongs to (shown in the header). */
  workspaceRootPath: string;
  /** OpenCode session id this transcript was exported from. */
  sessionId: string | null;
  messages: readonly ChatMessage[];
  /** ISO timestamp for the "Exported at" line. Injected so tests are stable. */
  exportedAt?: string;
}

const ROLE_LABELS: Record<ChatMessage["role"], string> = {
  user: "User",
  assistant: "Assistant",
  system: "System",
};

function escapeFrontMatterValue(value: string): string {
  // Front-matter values are plain scalars on one line; collapse newlines.
  return value.replace(/\r?\n/g, " ").trim();
}

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toISOString();
}

function renderToolCall(toolCall: NonNullable<ChatMessage["toolCalls"]>[number]): string {
  const isError = toolCall.status === "failure";
  const header = `**Tool: ${toolCall.toolName}${isError ? " (failed)" : ""}**`;
  let inputBlock = "";
  if (toolCall.input !== undefined && toolCall.input !== null) {
    inputBlock = `\n\n<details><summary>input</summary>\n\n\`\`\`json\n${formatToolPayload(
      toolCall.input,
    )}\n\`\`\`\n\n</details>`;
  }
  let outputBlock = "";
  if (toolCall.output !== undefined && toolCall.output !== null) {
    const label = isError ? "error" : "output";
    outputBlock = `\n\n<details><summary>${label}</summary>\n\n\`\`\`json\n${formatToolPayload(
      toolCall.output,
    )}\n\`\`\`\n\n</details>`;
  }
  return `${header}${inputBlock}${outputBlock}`;
}

function formatToolPayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

/**
 * Renders one message to a Markdown block. Returns an empty string when the
 * message has no displayable content (no text and no tool calls) — the caller
 * filters those out so we never emit a header with an empty body.
 */
function renderMessage(message: ChatMessage): string {
  const roleLabel = ROLE_LABELS[message.role] ?? "Message";
  const timestamp = formatTimestamp(message.createdAt);
  const heading = `### ${roleLabel} · ${timestamp}`;

  const bodyParts: string[] = [];
  if (message.content.trim().length > 0) {
    bodyParts.push(message.content.trim());
  }
  if (message.toolCalls && message.toolCalls.length > 0) {
    bodyParts.push(message.toolCalls.map(renderToolCall).join("\n\n"));
  }

  if (bodyParts.length === 0) {
    return "";
  }
  return `${heading}\n\n${bodyParts.join("\n\n")}`;
}

export function buildSessionTranscriptMarkdown(input: ExportTranscriptInput): string {
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const title = escapeFrontMatterValue(input.title) || "Untitled session";
  const lines: string[] = [
    "# Session transcript",
    "",
    `- **Title:** ${title}`,
    `- **Workspace:** \`${input.workspaceRootPath}\``,
  ];
  if (input.sessionId) {
    lines.push(`- **Session ID:** \`${input.sessionId}\``);
  }
  lines.push(`- **Exported at:** ${formatTimestamp(exportedAt)}`);
  lines.push(`- **Messages:** ${input.messages.length}`);

  const rendered = input.messages
    .map(renderMessage)
    .filter((block) => block.length > 0);

  if (rendered.length === 0) {
    lines.push("", "_No messages._", "");
    return lines.join("\n");
  }

  lines.push("", "---", "");
  // Each message block separated by a blank line; trailing newline.
  lines.push(...rendered.join("\n\n").split("\n"));
  lines.push("");
  return lines.join("\n");
}

/**
 * Suggests a safe filename (without path) for an exported transcript. Falls
 * back to the session id / "session" when the title has no useful characters.
 */
export function suggestExportFileName(title: string, sessionId: string | null): string {
  const slug =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || sessionId || "session";
  return `${slug}.md`;
}
