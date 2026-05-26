import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_ACCESS_POLL_INTERVAL_MS,
  stopChatAccessMonitor,
  syncChatAccessMonitor,
} from "./chatAccessMonitor";
import { chatStore } from "../state/chatStore";

vi.mock("../state/chatStore", () => ({
  chatStore: {
    runAccessPreflight: vi.fn(),
  },
}));

const runAccessPreflightMock = vi.mocked(chatStore.runAccessPreflight);

describe("chatAccessMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runAccessPreflightMock.mockReset();
    stopChatAccessMonitor();
  });

  afterEach(() => {
    stopChatAccessMonitor();
    vi.useRealTimers();
  });

  it("polls chat preflight while monitor is active", () => {
    syncChatAccessMonitor(true);
    expect(runAccessPreflightMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(CHAT_ACCESS_POLL_INTERVAL_MS);
    expect(runAccessPreflightMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(CHAT_ACCESS_POLL_INTERVAL_MS);
    expect(runAccessPreflightMock).toHaveBeenCalledTimes(2);
  });

  it("stops polling when monitor is deactivated", () => {
    syncChatAccessMonitor(true);
    syncChatAccessMonitor(false);

    vi.advanceTimersByTime(CHAT_ACCESS_POLL_INTERVAL_MS * 2);
    expect(runAccessPreflightMock).not.toHaveBeenCalled();
  });
});
