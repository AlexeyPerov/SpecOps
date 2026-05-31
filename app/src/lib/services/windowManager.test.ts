import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  createNewWindowWithTransfer,
  WINDOW_EVENT_TRANSFER_TAB,
  WINDOW_EVENT_WINDOW_READY,
} from "./windowManager";
import { updateLastActiveWindow } from "./sessionManager";

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(),
  WebviewWindow: vi.fn(),
}));

vi.mock("./sessionManager", () => ({
  updateLastActiveWindow: vi.fn().mockResolvedValue(undefined),
  getLastActiveWindowId: vi.fn(),
}));

const emitToMock = vi.mocked(emitTo);
const listenMock = vi.mocked(listen);
const getCurrentWebviewWindowMock = vi.mocked(getCurrentWebviewWindow);
const WebviewWindowMock = vi.mocked(WebviewWindow);
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

describe("createNewWindowWithTransfer", () => {
  beforeEach(() => {
    emitToMock.mockClear();
    listenMock.mockReset();
    getCurrentWebviewWindowMock.mockReset();
    WebviewWindowMock.mockReset();
    updateLastActiveWindowMock.mockClear();

    getCurrentWebviewWindowMock.mockReturnValue({
      outerPosition: vi.fn().mockResolvedValue({ x: 100, y: 200 }),
      innerSize: vi.fn().mockResolvedValue({ width: 900, height: 700 }),
    } as never);
  });

  it("resolves with label for empty window on created", async () => {
    installWebviewWindowMock();

    const createdWindowId = await createNewWindowWithTransfer({} as never, null);
    expect(createdWindowId).toMatch(/^window-\d+$/);
    expect(updateLastActiveWindowMock).toHaveBeenCalledWith(createdWindowId);
    expect(emitToMock).not.toHaveBeenCalled();
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
    const transferPromise = createNewWindowWithTransfer({} as never, {
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

    await expect(createNewWindowWithTransfer({} as never, null)).resolves.toBeNull();
  });
});
