import { beforeEach, describe, expect, it, vi } from "vitest";
import { message } from "@tauri-apps/plugin-dialog";
import type { DocumentState } from "../domain/contracts";
import { needsCloseConfirmation, promptUnsavedClose } from "./unsavedClosePrompt";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn(),
}));

const messageMock = vi.mocked(message);

function doc(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    id: "doc-1",
    title: "Draft.txt",
    filePath: null,
    content: "hello",
    savedContent: "",
    isDirty: true,
    contentKind: "text",
    language: "plaintext",
    encoding: "utf-8",
    lineEnding: "lf",
    diskFingerprint: null,
    dismissedFingerprint: null,
    fileMissing: false,
    scrollTop: 0,
    markdownViewMode: "edit",
    ...overrides,
  };
}

describe("needsCloseConfirmation", () => {
  it("returns true only for dirty documents", () => {
    expect(needsCloseConfirmation(doc())).toBe(true);
    expect(needsCloseConfirmation(doc({ isDirty: false }))).toBe(false);
  });
});

describe("promptUnsavedClose", () => {
  beforeEach(() => {
    messageMock.mockReset();
  });

  it("maps Save to save", async () => {
    messageMock.mockResolvedValue("Save");
    await expect(promptUnsavedClose(doc())).resolves.toBe("save");
  });

  it("maps Don't Save to discard", async () => {
    messageMock.mockResolvedValue("Don't Save");
    await expect(promptUnsavedClose(doc())).resolves.toBe("discard");
  });

  it("maps Cancel to cancel", async () => {
    messageMock.mockResolvedValue("Cancel");
    await expect(promptUnsavedClose(doc())).resolves.toBe("cancel");
  });
});
