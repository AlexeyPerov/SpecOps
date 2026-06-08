import { join } from "@tauri-apps/api/path";
import { mkdir } from "@tauri-apps/plugin-fs";
import { CHAT_HTTP_CONTEXT_ID } from "../domain/contracts";
import type { ChatScopeKey } from "../state/chatStore/types";
import { ensureSpecOpsDataDir } from "./appDataDir";
import { workspaceChatPathHashKey } from "./chatPersistenceCodec";

const CHAT_DIR_NAME = "chat";
const AGENTS_INDEX_FILE = "index.json";

/** Resolves the on-disk segment under `chat/` for a chat scope key. */
export function chatScopeStorageSegment(scopeKey: ChatScopeKey): string {
  if (scopeKey === CHAT_HTTP_CONTEXT_ID) {
    return CHAT_HTTP_CONTEXT_ID;
  }
  return workspaceChatPathHashKey(scopeKey);
}

export async function getWorkspaceAgentsDir(scopeKey: ChatScopeKey): Promise<string> {
  const base = await ensureSpecOpsDataDir();
  const chatDir = await join(base, CHAT_DIR_NAME);
  const workspaceDir = await join(chatDir, chatScopeStorageSegment(scopeKey));
  await mkdir(workspaceDir, { recursive: true });
  return workspaceDir;
}

export async function getWorkspaceAgentsIndexFilePath(scopeKey: ChatScopeKey): Promise<string> {
  const workspaceDir = await getWorkspaceAgentsDir(scopeKey);
  return join(workspaceDir, AGENTS_INDEX_FILE);
}

export async function getAgentThreadFilePath(
  scopeKey: ChatScopeKey,
  agentId: string,
): Promise<string> {
  const workspaceDir = await getWorkspaceAgentsDir(scopeKey);
  return join(workspaceDir, `${agentId}.json`);
}
