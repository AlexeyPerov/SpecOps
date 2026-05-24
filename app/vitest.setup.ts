import { vi } from "vitest";

vi.mock("./src/lib/services/recentFilesSync", () => ({
  commitRecentFiles: vi.fn().mockResolvedValue(undefined),
  listenForRecentFilesChanges: vi.fn().mockResolvedValue(() => {}),
  WINDOW_EVENT_RECENT_FILES_CHANGED: "spec-ops/window/recent-files-changed",
}));
