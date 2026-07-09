/**
 * P7 regression guardrails — cross-cutting checks that the P2–P6 optimized
 * pathways stay wired correctly together (ordering, memoization, deferral).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDomainState, DocumentState, TabState } from "../domain/contracts";
import { createFileTab, createSessionTab, createSinglePaneLayout } from "../domain/contracts";
import {
  resetAppShellEffectsForTests,
  syncExternalFileWatcherEffect,
  syncProjectTreeWatcherEffect,
  type SyncExternalFileWatcherEffectInput,
  type SyncProjectTreeWatcherEffectInput,
} from "./appShellEffects";
import { externalFileWatcherSyncKey, watchedPathsFromState } from "./appShellHelpers";
import { mapWithConcurrency } from "./mapWithConcurrency";
import { buildDocumentByIdMap, tabDocumentFromMap } from "./tabDocumentLookup";

vi.mock("./fileWatcher", () => ({
  syncProjectTreeWatcher: vi.fn(async () => {}),
}));

import { syncProjectTreeWatcher } from "./fileWatcher";

function emptyDocument(id: string, filePath: string | null, overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    id,
    filePath,
    title: id,
    content: "",
    savedContent: "",
    isDirty: false,
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

function domainState(overrides: {
  openTabs?: TabState[];
  documents?: DocumentState[];
  watchExternalChanges?: boolean;
}): AppDomainState {
  const snapshot = {
    documents: overrides.documents ?? [],
    session: {
      editorLayout: createSinglePaneLayout(overrides.openTabs ?? [], null),
      lastActiveWindowId: "main",
      windowBounds: null,
    },
  };
  return {
    contexts: {
      activeContextId: "notepad",
      notepad: snapshot,
      chatHttp: snapshot,
      workspaces: [],
    },
    settings: {
      externalFiles: {
        watchExternalChanges: overrides.watchExternalChanges ?? true,
      },
    } as AppDomainState["settings"],
    theme: {} as AppDomainState["theme"],
    recentFiles: [],
    editor: {} as AppDomainState["editor"],
    activityRailWidthPx: 48,
  };
}

describe("P7 optimization regression guardrails", () => {
  const syncWatcher = vi.mocked(syncProjectTreeWatcher);

  beforeEach(() => {
    resetAppShellEffectsForTests();
    syncWatcher.mockClear();
  });

  describe("P2 hydration concurrency helper", () => {
    it("keeps priority-order results under bounded concurrency", async () => {
      const started: number[] = [];
      let inFlight = 0;
      let maxInFlight = 0;

      const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
        started.push(n);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, n === 1 ? 15 : 2));
        inFlight -= 1;
        return `p${n}`;
      });

      expect(results).toEqual(["p1", "p2", "p3", "p4", "p5"]);
      expect(started.slice(0, 2)).toEqual([1, 2]);
      expect(maxInFlight).toBeLessThanOrEqual(2);
    });
  });

  describe("P3 project tree load triggers", () => {
    function makeTreeInput(
      overrides: Partial<SyncProjectTreeWatcherEffectInput> & {
        loadProjectTreeRoot: () => Promise<void>;
      },
    ): SyncProjectTreeWatcherEffectInput {
      return {
        runtimeReady: true,
        activeWorkspaceRoot: "/repo",
        isChatHttpActive: false,
        projectTreeController: {
          clearFilesystemChangeDebounce: vi.fn(),
        } as unknown as SyncProjectTreeWatcherEffectInput["projectTreeController"],
        ...overrides,
      };
    }

    it("does not re-root-load across repeated tab/session-style effect invocations", () => {
      const loadProjectTreeRoot = vi.fn(async () => {});
      const input = makeTreeInput({ loadProjectTreeRoot });

      for (let i = 0; i < 8; i += 1) {
        syncProjectTreeWatcherEffect({ ...input });
      }

      expect(loadProjectTreeRoot).toHaveBeenCalledTimes(1);
      expect(syncWatcher).toHaveBeenCalledTimes(1);
      expect(syncWatcher).toHaveBeenCalledWith("/repo");
    });

    it("reloads once per workspace-root transition only", () => {
      const loadProjectTreeRoot = vi.fn(async () => {});

      syncProjectTreeWatcherEffect(
        makeTreeInput({ loadProjectTreeRoot, activeWorkspaceRoot: "/repo-a" }),
      );
      syncProjectTreeWatcherEffect(
        makeTreeInput({ loadProjectTreeRoot, activeWorkspaceRoot: "/repo-a" }),
      );
      syncProjectTreeWatcherEffect(
        makeTreeInput({ loadProjectTreeRoot, activeWorkspaceRoot: "/repo-b" }),
      );
      syncProjectTreeWatcherEffect(
        makeTreeInput({ loadProjectTreeRoot, activeWorkspaceRoot: "/repo-b" }),
      );
      syncProjectTreeWatcherEffect(
        makeTreeInput({ loadProjectTreeRoot, activeWorkspaceRoot: "/repo-a" }),
      );

      expect(loadProjectTreeRoot).toHaveBeenCalledTimes(3);
      expect(syncWatcher).toHaveBeenNthCalledWith(1, "/repo-a");
      expect(syncWatcher).toHaveBeenNthCalledWith(2, "/repo-b");
      expect(syncWatcher).toHaveBeenNthCalledWith(3, "/repo-a");
    });
  });

  describe("P5 tab render lookup path", () => {
    it("matches linear find results while avoiding repeated scans", () => {
      const documents = Array.from({ length: 80 }, (_, i) =>
        emptyDocument(`doc-${i}`, i % 7 === 0 ? null : `/repo/f-${i}.txt`),
      );
      const tabs = [
        ...documents.map((d, i) => createFileTab(`tab-${i}`, d.id)),
        createSessionTab("tab-session", "agent-1"),
      ];
      const byId = buildDocumentByIdMap(documents);

      for (const tab of tabs) {
        const viaMap = tabDocumentFromMap(tab, byId);
        const viaFind =
          tab.kind === "file" ? documents.find((doc) => doc.id === tab.documentId) : undefined;
        expect(viaMap).toEqual(viaFind);
      }
    });
  });

  describe("P6 watcher sync memoization", () => {
    function makeWatcherInput(
      overrides: Partial<SyncExternalFileWatcherEffectInput> & {
        syncExternalFileWatcher: (state: AppDomainState) => Promise<void>;
      },
    ): SyncExternalFileWatcherEffectInput {
      return {
        runtimeReady: true,
        snapshot:
          overrides.snapshot ??
          domainState({
            openTabs: [createFileTab("tab-1", "doc-1")],
            documents: [emptyDocument("doc-1", "/tmp/a.txt")],
          }),
        ...overrides,
      };
    }

    it("keeps sync key stable across non-path document churn", () => {
      const base = domainState({
        openTabs: [createFileTab("tab-a", "doc-a"), createFileTab("tab-b", "doc-b")],
        documents: [emptyDocument("doc-a", "/repo/a.txt"), emptyDocument("doc-b", "/repo/b.txt")],
      });
      const churned = domainState({
        openTabs: [createFileTab("tab-a", "doc-a"), createFileTab("tab-b", "doc-b")],
        documents: [
          emptyDocument("doc-a", "/repo/a.txt"),
          emptyDocument("doc-b", "/repo/b.txt", {
            content: "edited in memory",
            isDirty: true,
            scrollTop: 40,
            markdownViewMode: "preview",
          }),
        ],
      });

      expect(watchedPathsFromState(base).sort()).toEqual(["/repo/a.txt", "/repo/b.txt"]);
      expect(externalFileWatcherSyncKey(base)).toBe(externalFileWatcherSyncKey(churned));
    });

    it("skips redundant watcher sync effect calls for the same key", () => {
      const syncExternalFileWatcher = vi.fn(async () => {});
      const input = makeWatcherInput({ syncExternalFileWatcher });

      syncExternalFileWatcherEffect(input);
      syncExternalFileWatcherEffect(input);
      syncExternalFileWatcherEffect({
        ...input,
        snapshot: domainState({
          openTabs: [createFileTab("tab-1", "doc-1")],
          documents: [
            emptyDocument("doc-1", "/tmp/a.txt", { content: "noise", isDirty: true }),
          ],
        }),
      });

      expect(syncExternalFileWatcher).toHaveBeenCalledTimes(1);
    });

    it("re-syncs when a watched path changes", () => {
      const syncExternalFileWatcher = vi.fn(async () => {});
      const first = domainState({
        openTabs: [createFileTab("tab-1", "doc-1"), createFileTab("tab-2", "doc-2")],
        documents: [
          emptyDocument("doc-1", "/repo/a.txt"),
          emptyDocument("doc-2", "/repo/b.txt"),
        ],
      });
      const second = domainState({
        openTabs: [createFileTab("tab-1", "doc-1"), createFileTab("tab-2", "doc-2")],
        documents: [
          emptyDocument("doc-1", "/repo/a.txt"),
          emptyDocument("doc-2", "/repo/b-renamed.txt"),
        ],
      });

      syncExternalFileWatcherEffect(
        makeWatcherInput({ syncExternalFileWatcher, snapshot: first }),
      );
      syncExternalFileWatcherEffect(
        makeWatcherInput({ syncExternalFileWatcher, snapshot: second }),
      );

      expect(syncExternalFileWatcher).toHaveBeenCalledTimes(2);
      expect(watchedPathsFromState(second).sort()).toEqual([
        "/repo/a.txt",
        "/repo/b-renamed.txt",
      ]);
    });
  });
});
