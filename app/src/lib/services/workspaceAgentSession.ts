import type { AgentIndexEntry, AgentTabState, SessionState, TabState } from "../domain/contracts";
import { isAgentTab, isFileTab } from "../domain/contracts";
import { normalizeWorkspaceLayout } from "./panelLayout";
import {
  AGENT_DATE_GROUP_ORDER,
  groupAgentsByLastUsedDate,
} from "./chatAgents";

export function flattenSidebarAgents(
  agents: readonly AgentIndexEntry[],
  now = new Date(),
): AgentIndexEntry[] {
  const grouped = groupAgentsByLastUsedDate(agents, now);
  return AGENT_DATE_GROUP_ORDER.flatMap((group) => grouped[group]);
}

export function openAgentTabIds(openTabs: readonly TabState[]): string[] {
  return openTabs.filter(isAgentTab).map((tab) => tab.agentId);
}

export function agentExistsInIndex(
  agents: readonly AgentIndexEntry[],
  agentId: string,
): boolean {
  return agents.some((entry) => entry.id === agentId);
}

export function findNextOpenAgentTabAfterClose(
  openTabs: readonly TabState[],
  closedTabId: string,
): AgentTabState | null {
  const closedIndex = openTabs.findIndex((tab) => tab.id === closedTabId);
  if (closedIndex < 0) {
    return null;
  }
  const closed = openTabs[closedIndex];
  if (!isAgentTab(closed)) {
    return null;
  }

  for (let index = closedIndex + 1; index < openTabs.length; index += 1) {
    const tab = openTabs[index];
    if (isAgentTab(tab)) {
      return tab;
    }
  }
  for (let index = closedIndex - 1; index >= 0; index -= 1) {
    const tab = openTabs[index];
    if (isAgentTab(tab)) {
      return tab;
    }
  }
  return null;
}

/** Next row in grouped sidebar order; returns null when there is no row below. */
export function nextSidebarAgentId(
  agents: readonly AgentIndexEntry[],
  currentAgentId: string,
  now = new Date(),
): string | null {
  const ordered = flattenSidebarAgents(agents, now);
  const currentIndex = ordered.findIndex((entry) => entry.id === currentAgentId);
  if (currentIndex < 0 || currentIndex + 1 >= ordered.length) {
    return null;
  }
  return ordered[currentIndex + 1].id;
}

export function resolveRestoredActiveAgent(
  session: SessionState,
  agentIndex: readonly AgentIndexEntry[],
): {
  activeAgentId: string | null;
  shouldFocusAgentTab: boolean;
} {
  const lastActiveAgentId = session.lastActiveAgentId ?? null;
  if (lastActiveAgentId && agentExistsInIndex(agentIndex, lastActiveAgentId)) {
    return { activeAgentId: lastActiveAgentId, shouldFocusAgentTab: true };
  }
  return { activeAgentId: null, shouldFocusAgentTab: false };
}

export interface AgentSessionMapping {
  agentId: string;
  sessionId: string;
  modelId?: string;
  providerId?: string;
}

export function mappedSessionForAgent(
  agents: readonly AgentIndexEntry[],
  agentId: string,
): AgentSessionMapping | null {
  const entry = agents.find((candidate) => candidate.id === agentId);
  if (!entry?.opencodeSessionId) {
    return null;
  }
  return {
    agentId,
    sessionId: entry.opencodeSessionId,
    modelId: entry.opencodeModelId,
    providerId: entry.opencodeProviderId,
  };
}

export function isAgentSessionMappingValid(
  mapping: AgentSessionMapping | null,
  existingSessionIds: ReadonlySet<string>,
): boolean {
  return mapping !== null && existingSessionIds.has(mapping.sessionId);
}

export function reconcileAgentSessionMapping(input: {
  mapping: AgentSessionMapping | null;
  existingSessionIds: ReadonlySet<string>;
  createdSessionId: string;
}): { sessionId: string; shouldReplaceMapping: boolean } {
  const { mapping, existingSessionIds, createdSessionId } = input;
  if (mapping && existingSessionIds.has(mapping.sessionId)) {
    return { sessionId: mapping.sessionId, shouldReplaceMapping: false };
  }
  return { sessionId: createdSessionId, shouldReplaceMapping: true };
}

/** When last-active agent is gone, avoid leaving an agent tab selected in the tab bar. */
export function selectedTabAfterMissingLastAgent(
  openTabs: readonly TabState[],
  selectedTabId: string | null,
): string | null {
  const selected = openTabs.find((tab) => tab.id === selectedTabId);
  if (!selected || !isAgentTab(selected)) {
    return selectedTabId;
  }
  const fileTab = openTabs.find(isFileTab);
  return fileTab?.id ?? selectedTabId;
}

export function normalizeSessionState(session: SessionState): SessionState {
  return {
    ...session,
    lastActiveAgentId: session.lastActiveAgentId ?? null,
    layout: session.layout ? normalizeWorkspaceLayout(session.layout) : undefined,
  };
}
