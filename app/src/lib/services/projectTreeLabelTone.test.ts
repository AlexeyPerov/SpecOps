import { describe, expect, it } from "vitest";
import { classifyProjectTreeLabelTone } from "./projectTreeLabelTone";

describe("classifyProjectTreeLabelTone", () => {
  it("marks dot-prefixed files and folders as hidden", () => {
    expect(classifyProjectTreeLabelTone(".env", "file")).toBe("hidden");
    expect(classifyProjectTreeLabelTone(".git", "directory")).toBe("hidden");
    expect(classifyProjectTreeLabelTone(".notes.md", "file")).toBe("hidden");
  });

  it("prefers hidden over text extensions", () => {
    expect(classifyProjectTreeLabelTone(".secret.txt", "file")).toBe("hidden");
  });

  it("marks txt, md, and extensionless files as text", () => {
    expect(classifyProjectTreeLabelTone("readme.txt", "file")).toBe("text");
    expect(classifyProjectTreeLabelTone("README.md", "file")).toBe("text");
    expect(classifyProjectTreeLabelTone("notes.markdown", "file")).toBe("text");
    expect(classifyProjectTreeLabelTone("Dockerfile", "file")).toBe("text");
    expect(classifyProjectTreeLabelTone("LICENSE", "file")).toBe("text");
  });

  it("uses default for other files and non-hidden folders", () => {
    expect(classifyProjectTreeLabelTone("index.ts", "file")).toBe("default");
    expect(classifyProjectTreeLabelTone("archive.tar.gz", "file")).toBe("default");
    expect(classifyProjectTreeLabelTone("data.bin", "file")).toBe("default");
    expect(classifyProjectTreeLabelTone("src", "directory")).toBe("default");
  });
});
