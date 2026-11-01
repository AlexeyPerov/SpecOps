import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitTo } from "@tauri-apps/api/event";
import { listenForWindowFileCommands } from "./windowFileCommands";
import { selectTabForNormalizedPath } from "./openFileGate";
import { WINDOW_EVENT_ACTIVATE_FILE, WINDOW_EVENT_SELECT_TAB_FOR_PATH } from "./windowManager";

const bus = vi.hoisted(() => ({
  activeHandlerWindow: "",
  registeringWindow: "",
  deliveries: 0,
  listeners: new Set<{ event: string; window: string; target?: string; handler: (event: any) => any }>(),
}));
vi.mock("./openFileGate", () => ({ selectTabForNormalizedPath: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: (event: any) => any, options?: { target: string }) => {
    const entry = { event, handler, window: bus.registeringWindow, target: options?.target };
    bus.listeners.add(entry);
    return () => { bus.listeners.delete(entry); };
  },
  // Like the native event bus, an unscoped listener receives emitTo deliveries too.
  emitTo: async (target: string, event: string, payload: any) => {
    if (++bus.deliveries > 10) throw new Error("File routing loop");
    for (const entry of bus.listeners) {
      if (entry.event === event && (!entry.target || entry.target === target)) {
        bus.activeHandlerWindow = entry.window;
        await entry.handler({ payload });
      }
    }
  },
}));

beforeEach(() => {
  bus.listeners.clear();
  bus.deliveries = 0;
  vi.mocked(selectTabForNormalizedPath).mockReset();
});

describe("window file command routing", () => {
  it("selects a file only in its owner without a redirect loop through the empty window", async () => {
    bus.registeringWindow = "empty";
    const redirect = vi.fn(async (path: string) => {
      await emitTo("owner", WINDOW_EVENT_SELECT_TAB_FOR_PATH, { path });
    });
    await listenForWindowFileCommands("empty", { openAndActivatePath: redirect, notify: vi.fn() });
    bus.registeringWindow = "owner";
    const reopen = vi.fn(async () => {});
    await listenForWindowFileCommands("owner", { openAndActivatePath: reopen, notify: vi.fn() });
    vi.mocked(selectTabForNormalizedPath).mockImplementation(() => bus.activeHandlerWindow === "owner");

    await emitTo("owner", WINDOW_EVENT_SELECT_TAB_FOR_PATH, { path: "/tmp/shared.txt" });

    expect(selectTabForNormalizedPath).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
    expect(reopen).not.toHaveBeenCalled();
    expect(bus.deliveries).toBe(1);
  });

  it("opens addressed files only in the destination and detaches listeners on cleanup", async () => {
    const openSource = vi.fn(async () => {});
    bus.registeringWindow = "source";
    await listenForWindowFileCommands("source", { openAndActivatePath: openSource, notify: vi.fn() });
    bus.registeringWindow = "target";
    const openTarget = vi.fn(async () => {});
    const cleanup = await listenForWindowFileCommands("target", { openAndActivatePath: openTarget, notify: vi.fn() });
    await emitTo("target", WINDOW_EVENT_ACTIVATE_FILE, { path: "/tmp/new.txt" });
    expect(openTarget).toHaveBeenCalledExactlyOnceWith("/tmp/new.txt");
    expect(openSource).not.toHaveBeenCalled();
    cleanup();
    await emitTo("target", WINDOW_EVENT_ACTIVATE_FILE, { path: "/tmp/closed.txt" });
    expect(openTarget).toHaveBeenCalledTimes(1);
  });

  it("reopens a missing owner tab and reports a failed open", async () => {
    vi.mocked(selectTabForNormalizedPath).mockReturnValue(false);
    const notify = vi.fn();
    const open = vi.fn().mockRejectedValue(new Error("file missing"));
    await listenForWindowFileCommands("owner", { openAndActivatePath: open, notify });
    await emitTo("owner", WINDOW_EVENT_SELECT_TAB_FOR_PATH, { path: "/tmp/missing.txt" });
    expect(open).toHaveBeenCalledWith("/tmp/missing.txt");
    expect(notify).toHaveBeenCalledWith("Failed to open routed file: file missing");
  });
});
