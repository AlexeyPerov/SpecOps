import { describe, expect, it, vi } from "vitest";
import {
  notifyDocumentDiskReload,
  subscribeDocumentDiskReload,
} from "./editorSessionLifecycle";

describe("editorSessionLifecycle", () => {
  it("notifies subscribers of document disk reloads with their context id", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDocumentDiskReload(listener);

    notifyDocumentDiskReload("doc-1", "ws-1");
    expect(listener).toHaveBeenCalledWith("doc-1", "ws-1");

    unsubscribe();
    notifyDocumentDiskReload("doc-2", "ws-1");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ignores empty document ids", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDocumentDiskReload(listener);
    notifyDocumentDiskReload("", "ws-1");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
