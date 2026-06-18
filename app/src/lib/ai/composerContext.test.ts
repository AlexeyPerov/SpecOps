import { describe, expect, it } from "vitest";
import {
  buildSendContext,
  inferAttachmentMime,
  isImageMime,
  parseAgentToken,
  parseFilePathToken,
  type ComposerAttachment,
} from "./composerContext";
import { mentionTokenForAgent, mentionTokenForFile } from "./backends/opencodeSearch";

function attachment(overrides: Partial<ComposerAttachment> = {}): ComposerAttachment {
  return {
    id: "att-1",
    filename: "report.pdf",
    mime: "application/pdf",
    url: "file:///tmp/report.pdf",
    isImage: false,
    ...overrides,
  };
}

describe("composerContext.isImageMime", () => {
  it("classifies known image mimes", () => {
    expect(isImageMime("image/png")).toBe(true);
    expect(isImageMime("image/jpeg")).toBe(true);
    expect(isImageMime("image/svg+xml")).toBe(true);
  });

  it("classifies unknown image/* subtypes as images", () => {
    expect(isImageMime("image/avif")).toBe(true);
    expect(isImageMime("image/custom")).toBe(true);
  });

  it("rejects non-image mimes", () => {
    expect(isImageMime("application/pdf")).toBe(false);
    expect(isImageMime("text/plain")).toBe(false);
  });

  it("normalizes case and whitespace", () => {
    expect(isImageMime("  IMAGE/PNG  ")).toBe(true);
  });
});

describe("composerContext.inferAttachmentMime", () => {
  it("uses the file's declared type when present", () => {
    expect(inferAttachmentMime({ type: "image/png", name: "x.txt" })).toBe("image/png");
  });

  it("infers from extension when type is empty", () => {
    expect(inferAttachmentMime({ type: "", name: "photo.jpg" })).toBe("image/jpeg");
    expect(inferAttachmentMime({ name: "data.json" })).toBe("application/json");
    expect(inferAttachmentMime({ name: "doc.md" })).toBe("text/plain");
    expect(inferAttachmentMime({ name: "clip.mp4" })).toBe("video/mp4");
  });

  it("falls back to octet-stream for unknown extensions", () => {
    expect(inferAttachmentMime({ name: "blob.xyz" })).toBe("application/octet-stream");
  });
});

describe("composerContext.buildSendContext", () => {
  it("returns undefined when nothing is attached", () => {
    expect(buildSendContext({ mentions: [], attachments: [] })).toBeUndefined();
  });

  it("routes file mentions to filePaths", () => {
    const ctx = buildSendContext({
      mentions: [mentionTokenForFile("src/a.ts"), mentionTokenForFile("README.md")],
      attachments: [],
    });
    expect(ctx).toEqual({ filePaths: ["src/a.ts", "README.md"] });
  });

  it("routes agent mentions to agentNames", () => {
    const ctx = buildSendContext({
      mentions: [mentionTokenForAgent("build", "Build")],
      attachments: [],
    });
    expect(ctx).toEqual({ agentNames: ["build"] });
  });

  it("maps attachments to { mime, filename?, url }", () => {
    const ctx = buildSendContext({
      mentions: [],
      attachments: [attachment({ filename: "doc.pdf", mime: "application/pdf", url: "file:///d" })],
    });
    expect(ctx).toEqual({
      attachments: [{ mime: "application/pdf", filename: "doc.pdf", url: "file:///d" }],
    });
  });

  it("combines mentions and attachments", () => {
    const ctx = buildSendContext({
      mentions: [mentionTokenForFile("a.ts"), mentionTokenForAgent("build", "Build")],
      attachments: [attachment()],
    });
    expect(ctx).toEqual({
      filePaths: ["a.ts"],
      agentNames: ["build"],
      attachments: [
        { mime: "application/pdf", filename: "report.pdf", url: "file:///tmp/report.pdf" },
      ],
    });
  });

  it("drops attachments with empty url or mime", () => {
    const ctx = buildSendContext({
      mentions: [],
      attachments: [
        attachment({ id: "a", url: "  ", mime: "application/pdf" }),
        attachment({ id: "b", url: "file:///x", mime: "  " }),
        attachment({ id: "c", url: "file:///y", mime: "application/pdf" }),
      ],
    });
    expect(ctx).toEqual({
      attachments: [{ mime: "application/pdf", filename: "report.pdf", url: "file:///y" }],
    });
  });

  it("omits filename when it is whitespace-only", () => {
    const ctx = buildSendContext({
      mentions: [],
      attachments: [attachment({ filename: "   ", url: "file:///x" })],
    });
    expect(ctx).toEqual({
      attachments: [{ mime: "application/pdf", url: "file:///x" }],
    });
  });

  it("trims mention values and skips empty ones", () => {
    // MentionToken with whitespace-only value is constructed manually.
    const ctx = buildSendContext({
      mentions: [
        { kind: "file", display: "@file:  ", value: "  " },
        mentionTokenForFile("real.ts"),
      ],
      attachments: [],
    });
    expect(ctx).toEqual({ filePaths: ["real.ts"] });
  });
});

describe("composerContext.parseFilePathToken / parseAgentToken", () => {
  it("parses a @file: token", () => {
    expect(parseFilePathToken("@file:src/a.ts")).toBe("src/a.ts");
  });

  it("returns null for a non-file token", () => {
    expect(parseFilePathToken("@agent:build")).toBeNull();
    expect(parseFilePathToken("hello")).toBeNull();
  });

  it("parses a @agent: token", () => {
    expect(parseAgentToken("@agent:Build")).toBe("Build");
  });

  it("returns null for a non-agent token", () => {
    expect(parseAgentToken("@file:src/a.ts")).toBeNull();
  });

  it("returns null when the inner value is empty", () => {
    expect(parseFilePathToken("@file:")).toBeNull();
    expect(parseAgentToken("@agent:")).toBeNull();
  });
});
