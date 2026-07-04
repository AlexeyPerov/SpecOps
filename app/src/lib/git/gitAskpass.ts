import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { GitAskpassRequest } from "./types";
import { promptGitCredentials } from "../services/askpassPrompt";

const ASKPASS_EVENT = "spec-ops/git/askpass-request";

let unlisten: UnlistenFn | null = null;
let startPromise: Promise<void> | null = null;

function mapAskpassRequest(payload: Record<string, unknown>): GitAskpassRequest | null {
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
  const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (!sessionId || !requestId || !prompt) {
    return null;
  }

  const inputKindRaw = typeof payload.inputKind === "string" ? payload.inputKind : "password";
  const inputKind =
    inputKindRaw === "username" || inputKindRaw === "passphrase" ? inputKindRaw : "password";

  const operationRaw = typeof payload.operation === "string" ? payload.operation : null;
  const operation =
    operationRaw === "fetch" ||
    operationRaw === "pull" ||
    operationRaw === "push" ||
    operationRaw === "tagPush" ||
    operationRaw === "tagDelete" ||
    operationRaw === "lsRemote"
      ? operationRaw
      : null;

  return {
    sessionId,
    requestId,
    prompt,
    hostHint: typeof payload.hostHint === "string" ? payload.hostHint : null,
    usernameHint: typeof payload.usernameHint === "string" ? payload.usernameHint : null,
    inputKind,
    operation,
    timeoutMs: typeof payload.timeoutMs === "number" ? payload.timeoutMs : 120_000,
  };
}

async function handleAskpassRequest(payload: Record<string, unknown>): Promise<void> {
  const request = mapAskpassRequest(payload);
  if (!request) {
    return;
  }

  const response = await promptGitCredentials(request);
  try {
    await invoke("respond_git_askpass", {
      sessionId: response.sessionId,
      requestId: response.requestId,
      value: response.value,
      cancelled: response.cancelled ?? false,
    });
  } catch {
    await invoke("respond_git_askpass", {
      sessionId: response.sessionId,
      requestId: response.requestId,
      value: "",
      cancelled: true,
    }).catch(() => {});
  }
}

/** Start listening for backend askpass credential requests. Idempotent. */
export async function startGitAskpassBridge(): Promise<void> {
  if (unlisten) {
    return;
  }
  if (startPromise) {
    return startPromise;
  }

  startPromise = (async () => {
    unlisten = await listen<Record<string, unknown>>(ASKPASS_EVENT, (event) => {
      void handleAskpassRequest(event.payload);
    });
  })();

  try {
    await startPromise;
  } finally {
    startPromise = null;
  }
}

/** Stop listening for askpass credential requests. */
export async function stopGitAskpassBridge(): Promise<void> {
  if (unlisten) {
    const dispose = unlisten;
    unlisten = null;
    dispose();
  }
}
