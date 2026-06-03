import { describe, expect, it } from "vitest";
import { promptEntryName, registerEntryNamePromptRunner } from "./entryNamePrompt";

describe("entryNamePrompt", () => {
  it("resolves null when no runner is registered", async () => {
    registerEntryNamePromptRunner(null);
    await expect(promptEntryName({ title: "Rename", defaultValue: "a.txt" })).resolves.toBeNull();
  });

  it("delegates to the registered runner", async () => {
    registerEntryNamePromptRunner(async (request) => {
      expect(request).toEqual({ title: "New file name", defaultValue: "untitled.txt" });
      return "notes.md";
    });
    await expect(
      promptEntryName({ title: "New file name", defaultValue: "untitled.txt" }),
    ).resolves.toBe("notes.md");
    registerEntryNamePromptRunner(null);
  });
});
