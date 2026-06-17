import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../domain/contracts";
import {
  buildSessionTranscriptMarkdown,
  suggestExportFileName,
} from "./opencodeSessionExport";

function userMessage(id: string, content: string, createdAt: string): ChatMessage {
  return { id, role: "user", content, createdAt };
}

function assistantMessage(
  id: string,
  content: string,
  createdAt: string,
  extras: Partial<ChatMessage> = {},
): ChatMessage {
  return { id, role: "assistant", content, createdAt, ...extras };
}

describe("opencodeSessionExport.buildSessionTranscriptMarkdown", () => {
  it("emits a header with title, workspace, session id, exported-at, and message count", () => {
    const markdown = buildSessionTranscriptMarkdown({
      title: "My session",
      workspaceRootPath: "/repo",
      sessionId: "sess-1",
      messages: [],
      exportedAt: "2026-06-17T12:00:00.000Z",
    });

    expect(markdown).toContain("# Session transcript");
    expect(markdown).toContain("**Title:** My session");
    expect(markdown).toContain("**Workspace:** `/repo`");
    expect(markdown).toContain("**Session ID:** `sess-1`");
    expect(markdown).toContain("**Exported at:** 2026-06-17T12:00:00.000Z");
    expect(markdown).toContain("**Messages:** 0");
    expect(markdown).toContain("_No messages._");
  });

  it("omits the session id line when none is provided", () => {
    const markdown = buildSessionTranscriptMarkdown({
      title: "Draft",
      workspaceRootPath: "/repo",
      sessionId: null,
      messages: [],
    });
    expect(markdown).not.toContain("Session ID");
  });

  it("renders one heading per message with role + timestamp + content", () => {
    const markdown = buildSessionTranscriptMarkdown({
      title: "T",
      workspaceRootPath: "/r",
      sessionId: "s",
      messages: [
        userMessage("u1", "hello there", "2026-06-17T10:00:00.000Z"),
        assistantMessage("a1", "hi back", "2026-06-17T10:00:05.000Z"),
      ],
      exportedAt: "2026-06-17T12:00:00.000Z",
    });

    expect(markdown).toContain("### User · 2026-06-17T10:00:00.000Z");
    expect(markdown).toContain("hello there");
    expect(markdown).toContain("### Assistant · 2026-06-17T10:00:05.000Z");
    expect(markdown).toContain("hi back");
    // Messages come after the --- separator.
    const separatorIndex = markdown.indexOf("---");
    const userHeadingIndex = markdown.indexOf("### User");
    expect(userHeadingIndex).toBeGreaterThan(separatorIndex);
  });

  it("folds tool calls into collapsible fenced json blocks", () => {
    const markdown = buildSessionTranscriptMarkdown({
      title: "T",
      workspaceRootPath: "/r",
      sessionId: "s",
      messages: [
        assistantMessage("a1", "", "2026-06-17T10:00:05.000Z", {
          toolCalls: [
            {
              callId: "c1",
              toolName: "read_file",
              status: "success",
              input: { path: "a.txt" },
              output: { content: "hi" },
            },
          ],
        }),
      ],
      exportedAt: "2026-06-17T12:00:00.000Z",
    });

    expect(markdown).toContain("**Tool: read_file**");
    expect(markdown).toContain("<summary>input</summary>");
    expect(markdown).toContain("<summary>output</summary>");
    expect(markdown).toContain('"path": "a.txt"');
  });

  it("labels failed tool calls with (failed) and an error summary", () => {
    const markdown = buildSessionTranscriptMarkdown({
      title: "T",
      workspaceRootPath: "/r",
      sessionId: "s",
      messages: [
        assistantMessage("a1", "", "2026-06-17T10:00:05.000Z", {
          toolCalls: [
            {
              callId: "c1",
              toolName: "write_file",
              status: "failure",
              output: "permission denied",
            },
          ],
        }),
      ],
      exportedAt: "2026-06-17T12:00:00.000Z",
    });

    expect(markdown).toContain("**Tool: write_file (failed)**");
    expect(markdown).toContain("<summary>error</summary>");
    expect(markdown).toContain("permission denied");
  });

  it("skips messages with no content and no tool calls", () => {
    const markdown = buildSessionTranscriptMarkdown({
      title: "T",
      workspaceRootPath: "/r",
      sessionId: "s",
      messages: [
        userMessage("u1", "keep", "2026-06-17T10:00:00.000Z"),
        assistantMessage("a1", "   ", "2026-06-17T10:00:05.000Z"),
      ],
      exportedAt: "2026-06-17T12:00:00.000Z",
    });

    expect(markdown).toContain("keep");
    expect(markdown).not.toContain("### Assistant");
  });

  it("escapes newlines in the title front-matter line", () => {
    const markdown = buildSessionTranscriptMarkdown({
      title: "multi\nline\ntitle",
      workspaceRootPath: "/r",
      sessionId: "s",
      messages: [],
    });
    // The title must collapse to a single line so it doesn't break the
    // bulleted front-matter.
    const titleLine = markdown.split("\n").find((line) => line.startsWith("- **Title:**"));
    expect(titleLine).toBeDefined();
    expect(titleLine).not.toContain("\n");
  });
});

describe("opencodeSessionExport.suggestExportFileName", () => {
  it("sluggifies the title into a lowercase kebab filename", () => {
    expect(suggestExportFileName("Fix the Bug!!!", "sess-1")).toBe("fix-the-bug.md");
  });

  it("falls back to the session id when the title has no slug chars", () => {
    expect(suggestExportFileName("!!!", "sess-42")).toBe("sess-42.md");
  });

  it("falls back to 'session' when neither title nor id is usable", () => {
    expect(suggestExportFileName("   ", "")).toBe("session.md");
  });

  it("truncates overly long slugs", () => {
    const long = "a".repeat(200);
    const name = suggestExportFileName(long, "s");
    expect(name.length).toBeLessThan(long.length);
    expect(name.endsWith(".md")).toBe(true);
  });
});
