import { describe, expect, it } from "vitest";
import {
  countMessageAttachments,
  extractMessageAttachments,
} from "./chatAttachments";
import type { ChatMessage, ChatMessagePart } from "../domain/contracts";

function message(parts: ChatMessagePart[], role: ChatMessage["role"] = "assistant"): ChatMessage {
  return {
    id: "msg-1",
    role,
    content: "",
    createdAt: "2026-06-17T00:00:00.000Z",
    parts,
  };
}

describe("extractMessageAttachments", () => {
  it("returns empty images/files when the message has no parts", () => {
    expect(extractMessageAttachments(message([]))).toEqual({ images: [], files: [] });
  });

  it("returns empty images/files when parts has no file part", () => {
    const msg = message([
      { type: "text", id: "t1", text: "answer" },
      { type: "reasoning", id: "r1", text: "thinking" },
    ]);
    expect(extractMessageAttachments(msg)).toEqual({ images: [], files: [] });
  });

  it("classifies an image/* mime as an image", () => {
    const msg = message([
      { type: "file", id: "f1", mime: "image/png", filename: "shot.png", url: "file:///a.png" },
    ]);
    const { images, files } = extractMessageAttachments(msg);
    expect(files).toEqual([]);
    expect(images).toEqual([
      {
        id: "f1",
        mime: "image/png",
        filename: "shot.png",
        url: "file:///a.png",
        isImage: true,
      },
    ]);
  });

  it("classifies a non-image mime as a file", () => {
    const msg = message([
      {
        type: "file",
        id: "f1",
        mime: "application/pdf",
        filename: "report.pdf",
        url: "file:///r.pdf",
      },
    ]);
    const { images, files } = extractMessageAttachments(msg);
    expect(images).toEqual([]);
    expect(files).toEqual([
      {
        id: "f1",
        mime: "application/pdf",
        filename: "report.pdf",
        url: "file:///r.pdf",
        isImage: false,
      },
    ]);
  });

  it("treats unknown image/* subtypes as images", () => {
    const msg = message([
      { type: "file", mime: "image/heic", url: "file:///a.heic" },
    ]);
    expect(extractMessageAttachments(msg).images).toHaveLength(1);
  });

  it("treats image/svg+xml as an image", () => {
    const msg = message([
      { type: "file", mime: "image/svg+xml", url: "file:///a.svg" },
    ]);
    expect(extractMessageAttachments(msg).images).toHaveLength(1);
  });

  it("normalizes mime case before classifying", () => {
    const msg = message([
      { type: "file", mime: "IMAGE/PNG", url: "file:///a.png" },
    ]);
    expect(extractMessageAttachments(msg).images).toHaveLength(1);
  });

  it("keeps images and files separate and in arrival order", () => {
    const msg = message([
      { type: "file", id: "f1", mime: "image/png", url: "u1" },
      { type: "file", id: "f2", mime: "application/pdf", url: "u2" },
      { type: "file", id: "f3", mime: "image/jpeg", url: "u3" },
      { type: "file", id: "f4", mime: "text/plain", url: "u4" },
    ]);
    const { images, files } = extractMessageAttachments(msg);
    expect(images.map((a) => a.id)).toEqual(["f1", "f3"]);
    expect(files.map((a) => a.id)).toEqual(["f2", "f4"]);
  });

  it("drops parts with empty or whitespace url/mime", () => {
    const msg = message([
      { type: "file", mime: "image/png", url: "   ", filename: "x" },
      { type: "file", mime: "  ", url: "file:///ok" },
      { type: "file", mime: "image/png", url: "file:///ok", filename: "kept" },
    ]);
    const { images } = extractMessageAttachments(msg);
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe("kept");
  });

  it("falls back to a synthesized id when the part has no id (position among file parts)", () => {
    const msg = message([
      { type: "text", id: "t1", text: "preamble" },
      { type: "file", mime: "image/png", url: "u1" },
    ]);
    expect(extractMessageAttachments(msg).images[0].id).toBe("msg-1:file:0");
  });

  it("omits filename when not set or whitespace-only", () => {
    const msg = message([
      { type: "file", mime: "image/png", url: "u1", filename: "   " },
    ]);
    const [image] = extractMessageAttachments(msg).images;
    expect(image.filename).toBeUndefined();
    expect("filename" in image).toBe(false);
  });

  it("does not gate on role — file parts render on user messages too", () => {
    const userMessage: ChatMessage = {
      id: "u1",
      role: "user",
      content: "here is a screenshot",
      createdAt: "2026-06-17T00:00:00.000Z",
      parts: [{ type: "file", id: "f1", mime: "image/png", url: "file:///p.png" }],
    };
    expect(extractMessageAttachments(userMessage).images).toHaveLength(1);
  });
});

describe("countMessageAttachments", () => {
  it("returns 0 when no file parts", () => {
    expect(countMessageAttachments(message([]))).toBe(0);
  });

  it("returns the total of images + files", () => {
    const msg = message([
      { type: "file", id: "f1", mime: "image/png", url: "u1" },
      { type: "file", id: "f2", mime: "application/pdf", url: "u2" },
      { type: "file", id: "f3", mime: "image/jpeg", url: "u3" },
    ]);
    expect(countMessageAttachments(msg)).toBe(3);
  });
});
