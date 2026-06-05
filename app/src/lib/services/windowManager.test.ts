import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  createNewWindowWithTransfer,
  resolveNewWindowBounds,
  WINDOW_EVENT_TRANSFER_TAB,
  WINDOW_EVENT_WINDOW_READY,
} from "./windowManager";
import { applyWindowBounds, readWindowBounds } from "./windowBounds";
import { updateLastActiveWindow } from "./sessionManager";
import type { AppDomainState, WindowBounds } from "../domain/contracts";
import { NOTEPAD_CONTEXT_ID } from "../state/appState/contextHelpers";

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(),
  WebviewWindow: vi.fn(),
}));

vi.mock("./windowBounds", () => ({
  readWindowBounds: vi.fn(),
  applyWindowBounds: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./sessionManager", () => ({
  updateLastActiveWindow: vi.fn().mockResolvedValue(undefined),
  getLastActiveWindowId: vi.fn(),
}));

const emitToMock = vi.mocked(emitTo);
const listenMock = vi.mocked(listen);
const getCurrentWebviewWindowMock = vi.mocked(getCurrentWebviewWindow);
const WebviewWindowMock = vi.mocked(WebviewWindow);
const readWindowBoundsMock = vi.mocked(readWindowBounds);
const applyWindowBoundsMock = vi.mocked(applyWindowBounds);
const updateLastActiveWindowMock = vi.mocked(updateLastActiveWindow);

type WindowHandlers = {
  created?: () => void | Promise<void>;
  error?: () => void;
};

function installWebviewWindowMock(handlers: WindowHandlers = {}): void {
  WebviewWindowMock.mockImplementationOnce(function WebviewWindowConstructor(
    windowLabel: string,
  ) {
    const instance = {
      label: windowLabel,
      once: vi.fn((event: string, callback: () => void | Promise<void>) => {
        if (event === "tauri://created") {
          handlers.created = callback;
        }
        if (event === "tauri://error") {
          handlers.error = callback;
        }
      }),
      show: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
    };
    queueMicrotask(() => {
      void handlers.created?.();
    });
    return instance as never;
  });
}

function snapshotWithBounds(bounds: WindowBounds | null): AppDomainState {
  return {
    contexts: {
      activeContextId: NOTEPAD_CONTEXT_ID,
      notepad: {
        documents: [],
        session: {
          openTabs: [],
          selectedTabId: null,
          lastActiveAgentId: null,
          lastActiveWindowId: "main",
          windowBounds: bounds,
        },
      },
      chatHttp: {
        documents: [],
        session: {
          openTabs: [],
          selectedTabId: null,
          lastActiveAgentId: null,
          lastActiveWindowId: "main",
          windowBounds: bounds,
        },
      },
      workspaces: [],
    },
    settings: {} as AppDomainState["settings"],
    theme: {} as AppDomainState["theme"],
    recentFiles: [],
    editor: {} as AppDomainState["editor"],
  };
}

describe("resolveNewWindowBounds", () => {
  beforeEach(() => {
    getCurrentWebviewWindowMock.mockReset();
    readWindowBoundsMock.mockReset();
  });

  it("prefers live parent bounds over persisted session bounds", async () => {
    getCurrentWebviewWindowMock.mockReturnValue({} as never);
    readWindowBoundsMock.mockResolvedValue({
      width: 900,
      height: 700,
      x: 100,
      y: 200,
      maximized: false,
    });

    const bounds = await resolveNewWindowBounds(
      snapshotWithBounds({ width: 400, height: 300, x: 0, y: 0, maximized: false }),
    );
    expect(bounds).toEqual({ width: 900, height: 700, x: 124, y: 224, maximized: false });
    expect(readWindowBoundsMock).toHaveBeenCalled();
  });

  it("reads parent window bounds when session has none", async () => {
    getCurrentWebviewWindowMock.mockReturnValue({} as never);
    readWindowBoundsMock.mockResolvedValue({
      width: 960,
      height: 600,
      x: 50,
      y: 80,
      maximized: false,
    });

    const bounds = await resolveNewWindowBounds(snapshotWithBounds(null));
    expect(bounds).toEqual({ width: 960, height: 600, x: 74, y: 104, maximized: false });
  });
});

describe("createNewWindowWithTransfer", () => {
  beforeEach(() => {
    emitToMock.mockClear();
    listenMock.mockReset();
    getCurrentWebviewWindowMock.mockReset();
    WebviewWindowMock.mockReset();
    readWindowBoundsMock.mockReset();
    applyWindowBoundsMock.mockClear();
    updateLastActiveWindowMock.mockClear();

    getCurrentWebviewWindowMock.mockReturnValue({} as never);
    readWindowBoundsMock.mockResolvedValue({
      width: 900,
      height: 700,
      x: 100,
      y: 200,
      maximized: false,
    });
  });

  it("resolves with label for empty window on created", async () => {
    installWebviewWindowMock();

    const createdWindowId = await createNewWindowWithTransfer(snapshotWithBounds(null), null);
    expect(createdWindowId).toMatch(/^window-\d+$/);
    expect(updateLastActiveWindowMock).toHaveBeenCalledWith(createdWindowId);
    expect(emitToMock).not.toHaveBeenCalled();
    expect(WebviewWindowMock).toHaveBeenCalledWith(
      createdWindowId,
      expect.objectContaining({ title: "SpecOps", url: "/" }),
    );
    expect(applyWindowBoundsMock).toHaveBeenCalled();
  });

  it("waits for ready handshake before emitting transfer payload", async () => {
    let readyHandler:
      | ((event: { payload: { windowId: string } }) => void | Promise<void>)
      | undefined;
    listenMock.mockImplementation(async (_event, handler) => {
      readyHandler = handler as typeof readyHandler;
      return vi.fn() as never;
    });

    installWebviewWindowMock();
    const transferPromise = createNewWindowWithTransfer(snapshotWithBounds(null), {
      filePath: "/tmp/move-me.txt",
      content: "payload",
      title: "move-me.txt",
    });

    await vi.waitFor(() => {
      expect(listenMock).toHaveBeenCalledWith(WINDOW_EVENT_WINDOW_READY, expect.any(Function));
    });

    const createdWindowId = WebviewWindowMock.mock.calls[0]?.[0] as string;
    expect(emitToMock).not.toHaveBeenCalledWith(
      createdWindowId,
      WINDOW_EVENT_TRANSFER_TAB,
      expect.anything(),
    );

    await readyHandler?.({ payload: { windowId: createdWindowId } });

    await expect(transferPromise).resolves.toBe(createdWindowId);
    expect(emitToMock).toHaveBeenCalledWith(createdWindowId, WINDOW_EVENT_TRANSFER_TAB, {
      filePath: "/tmp/move-me.txt",
      content: "payload",
      title: "move-me.txt",
    });
  });

  it("resolves null when webview creation errors", async () => {
    WebviewWindowMock.mockImplementationOnce(function WebviewWindowConstructor() {
      const instance = {
        once: vi.fn((event: string, callback: () => void) => {
          if (event === "tauri://error") {
            queueMicrotask(callback);
          }
        }),
        show: vi.fn(),
        setFocus: vi.fn(),
      };
      return instance as never;
    });

    await expect(createNewWindowWithTransfer(snapshotWithBounds(null), null)).resolves.toBeNull();
  });
});
