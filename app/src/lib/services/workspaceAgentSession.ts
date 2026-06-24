import type { SessionIndexEntry, SessionState, SessionTabState, TabState } from "../domain/contracts";
import { isFileTab, isSessionTab } from "../domain/contracts";
import { normalizeWorkspaceLayout } from "./panelLayout";
import {
  SESSION_DATE_GROUP_ORDER,
  groupSessionsByLastUsedDate,
} from "./chatSessions";

export function flattenSidebarSessions(
  sessions: readonly SessionIndexEntry[],
  now = new Date(),
): SessionIndexEntry[] {
  const grouped = groupSessionsByLastUsedDate(sessions, now);
  return SESSION_DATE_GROUP_ORDER.flatMap((group) => grouped[group]);
}

export function openSessionTabIds(openTabs: readonly TabState[]): string[] {
  return openTabs.filter(isSessionTab).map((tab) => tab.sessionId);
}

export function sessionExistsInIndex(
  sessions: readonly SessionIndexEntry[],
  sessionId: string,
): boolean {
  return sessions.some((entry) => entry.id === sessionId);
}

export function findNextOpenSessionTabAfterClose(
  openTabs: readonly TabState[],
  closedTabId: string,
): SessionTabState | null {
  const closedIndex = openTabs.findIndex((tab) => tab.id === closedTabId);
  if (closedIndex < 0) {
    return null;
  }
  const closed = openTabs[closedIndex];
  if (!isSessionTab(closed)) {
    return null;
  }

  for (let index = closedIndex + 1; index < openTabs.length; index += 1) {
    const tab = openTabs[index];
    if (isSessionTab(tab)) {
      return tab;
    }
  }
  for (let index = closedIndex - 1; index >= 0; index -= 1) {
    const tab = openTabs[index];
    if (isSessionTab(tab)) {
      return tab;
    }
  }
  return null;
}

/** Next row in grouped sidebar order; returns null when there is no row below. */
export function nextSidebarSessionId(
  sessions: readonly SessionIndexEntry[],
  currentSessionId: string,
  now = new Date(),
): string | null {
  const ordered = flattenSidebarSessions(sessions, now);
  const currentIndex = ordered.findIndex((entry) => entry.id === currentSessionId);
  if (currentIndex < 0 || currentIndex + 1 >= ordered.length) {
    return null;
  }
  return ordered[currentIndex + 1].id;
}

export function resolveRestoredActiveSession(
  session: SessionState,
  sessionIndex: readonly SessionIndexEntry[],
): {
  activeSessionId: string | null;
  shouldFocusSessionTab: boolean;
} {
  const lastActiveSessionId = session.lastActiveSessionId ?? null;
  if (lastActiveSessionId && sessionExistsInIndex(sessionIndex, lastActiveSessionId)) {
    return { activeSessionId: lastActiveSessionId, shouldFocusSessionTab: true };
  }
  return { activeSessionId: null, shouldFocusSessionTab: false };
}

export interface SessionMapping {
  sessionId: string;
  opencodeSessionId: string;
  modelId?: string;
  providerId?: string;
}

export function mappedSessionForId(
  sessions: readonly SessionIndexEntry[],
  sessionId: string,
): SessionMapping | null {
  const entry = sessions.find((candidate) => candidate.id === sessionId);
  if (!entry?.opencodeSessionId) {
    return null;
  }
  return {
    sessionId,
    opencodeSessionId: entry.opencodeSessionId,
    modelId: entry.opencodeModelId,
    providerId: entry.opencodeProviderId,
  };
}

export function isSessionMappingValid(
  mapping: SessionMapping | null,
  existingSessionIds: ReadonlySet<string>,
): boolean {
  return mapping !== null && existingSessionIds.has(mapping.opencodeSessionId);
}

export function reconcileSessionMapping(input: {
  mapping: SessionMapping | null;
  existingSessionIds: ReadonlySet<string>;
  createdSessionId: string;
}): { sessionId: string; shouldReplaceMapping: boolean } {
  const { mapping, existingSessionIds, createdSessionId } = input;
  if (mapping && existingSessionIds.has(mapping.opencodeSessionId)) {
    return { sessionId: mapping.opencodeSessionId, shouldReplaceMapping: false };
  }
  return { sessionId: createdSessionId, shouldReplaceMapping: true };
}

/** When last-active session is gone, avoid leaving a session tab selected in the tab bar. */
export function selectedTabAfterMissingLastSession(
  openTabs: readonly TabState[],
  selectedTabId: string | null,
): string | null {
  const selected = openTabs.find((tab) => tab.id === selectedTabId);
  if (!selected || !isSessionTab(selected)) {
    return selectedTabId;
  }
  const fileTab = openTabs.find(isFileTab);
  return fileTab?.id ?? selectedTabId;
}

export function normalizeSessionState(session: SessionState): SessionState {
  return {
    ...session,
    lastActiveSessionId: session.lastActiveSessionId ?? null,
    layout: session.layout ? normalizeWorkspaceLayout(session.layout) : undefined,
  };
}
