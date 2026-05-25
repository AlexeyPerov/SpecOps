import { join } from "@tauri-apps/api/path";
import { mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type {
  ChatMessage,
  ChatMessageRole,
  ChatModeId,
  ChatProviderId,
  ChatThreadFileSnapshot,
  ChatThreadMetadata,
  ChatThreadSnapshot,
} from "../domain/contracts";
import { ensureSpecOpsDataDir } from "./appDataDir";

const CHAT_VERSION = 1;
const CHAT_DIR_NAME = "chat";
const PERSIST_DEBOUNCE_MS = 700;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPersist: {
  normalizedRootPath: string;
  snapshot: ChatThreadFileSnapshot;
} | null = null;

/** Clears debounce timer state between unit tests. */
export function resetChatPersistenceForTests(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  pendingPersist = null;
}

function hashNormalizedPath(path: string): string {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function workspaceChatPathHashKey(normalizedRootPath: string): string {
  return hashNormalizedPath(normalizedRootPath);
}

function emptyChatSnapshot(): ChatThreadFileSnapshot {
  return {
    version: CHAT_VERSION,
    thread: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChatMessageRole(value: unknown): value is ChatMessageRole {
  return value === "user" || value === "assistant" || value === "system";
}

function isChatModeId(value: unknown): value is ChatModeId {
  return value === "ask" || value === "review";
}

function isChatProviderId(value: unknown): value is ChatProviderId {
  return value === "glm" || value === "cursor";
}

function parseThreadMetadata(value: unknown): ChatThreadMetadata | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !isChatModeId(value.mode) ||
    !isChatProviderId(value.provider) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  if (value.summary !== undefined && typeof value.summary !== "string") {
    return null;
  }
  return {
    mode: value.mode,
    provider: value.provider,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    summary: value.summary,
  };
}

function parseSystemEvent(value: unknown): ChatMessage["systemEvent"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.type !== "provider-switched") {
    return undefined;
  }

  const fromProvider = value.fromProvider;
  if (fromProvider !== null && !isChatProviderId(fromProvider)) {
    return undefined;
  }
  if (!isChatProviderId(value.toProvider)) {
    return undefined;
  }

  return {
    type: "provider-switched",
    fromProvider,
    toProvider: value.toProvider,
  };
}

function parseMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    !isChatMessageRole(value.role) ||
    typeof value.content !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    role: value.role,
    content: value.content,
    createdAt: value.createdAt,
    systemEvent: parseSystemEvent(value.systemEvent),
  };
}

function parseThread(value: unknown): ChatThreadSnapshot | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    return null;
  }

  const metadata = parseThreadMetadata(value.metadata);
  if (!metadata) {
    return null;
  }

  const messages: ChatMessage[] = [];
  for (const entry of value.messages) {
    const message = parseMessage(entry);
    if (!message) {
      return null;
    }
    messages.push(message);
  }

  return {
    metadata,
    messages,
  };
}

export function decodeChatThreadFileSnapshot(raw: string): ChatThreadFileSnapshot {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; thread?: unknown };
    if (parsed.version !== CHAT_VERSION) {
      return emptyChatSnapshot();
    }
    const thread = parseThread(parsed.thread);
    return {
      version: CHAT_VERSION,
      thread,
    };
  } catch {
    return emptyChatSnapshot();
  }
}

export function encodeChatThreadFileSnapshot(snapshot: ChatThreadFileSnapshot): string {
  const normalizedSnapshot: ChatThreadFileSnapshot =
    snapshot.version === CHAT_VERSION
      ? snapshot
      : {
          version: CHAT_VERSION,
          thread: snapshot.thread,
        };
  return JSON.stringify(normalizedSnapshot, null, 2);
}

export async function getWorkspaceChatFilePath(normalizedRootPath: string): Promise<string> {
  const base = await ensureSpecOpsDataDir();
  const chatDir = await join(base, CHAT_DIR_NAME);
  await mkdir(chatDir, { recursive: true });
  return join(chatDir, `${workspaceChatPathHashKey(normalizedRootPath)}.json`);
}

export async function readWorkspaceChatFileSnapshot(
  normalizedRootPath: string,
): Promise<ChatThreadFileSnapshot> {
  try {
    const chatPath = await getWorkspaceChatFilePath(normalizedRootPath);
    const raw = await readTextFile(chatPath);
    return decodeChatThreadFileSnapshot(raw);
  } catch {
    return emptyChatSnapshot();
  }
}

export async function writeWorkspaceChatFileSnapshot(
  normalizedRootPath: string,
  snapshot: ChatThreadFileSnapshot,
): Promise<void> {
  const chatPath = await getWorkspaceChatFilePath(normalizedRootPath);
  await writeTextFile(chatPath, encodeChatThreadFileSnapshot(snapshot));
}

export function scheduleWorkspaceChatFilePersistence(
  normalizedRootPath: string,
  snapshot: ChatThreadFileSnapshot,
): void {
  pendingPersist = { normalizedRootPath, snapshot };
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    const next = pendingPersist;
    pendingPersist = null;
    persistTimer = null;
    if (!next) {
      return;
    }
    void writeWorkspaceChatFileSnapshot(next.normalizedRootPath, next.snapshot);
  }, PERSIST_DEBOUNCE_MS);
}
