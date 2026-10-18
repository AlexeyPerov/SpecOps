import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { GitAskpassRequest } from "./types";
import { dismissAskpassRequest, promptGitCredentials } from "../services/askpassPrompt";

const ASKPASS_EVENT = "spec-ops/git/askpass-request";
/** The backend no longer needs an answer (answered in any window, cancelled, timed out, ended). */
const ASKPASS_RESOLVED_EVENT = "spec-ops/git/askpass-resolved";

let unlisten: UnlistenFn | null = null;
let startPromise: Promise<void> | null = null;
/** Bumped by stop so a start still awaiting `listen` disposes its listeners. */
let generation = 0;
let startGeneration = 0;

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
  if (!response) {
    return;
  }
  try {
    await invoke("respond_git_askpass", {
      request: {
        sessionId: response.sessionId,
        requestId: response.requestId,
        value: response.value,
        cancelled: response.cancelled ?? false,
      },
    });
  } catch {
    await invoke("respond_git_askpass", {
      request: {
        sessionId: response.sessionId,
        requestId: response.requestId,
        value: "",
        cancelled: true,
      },
    }).catch(() => {});
  }
}

/** Start listening for backend askpass credential requests. Idempotent. */
export async function startGitAskpassBridge(): Promise<void> {
  if (unlisten) {
    return;
  }
  if (startPromise && startGeneration === generation) {
    return startPromise;
  }

  const startedGeneration = generation;
  const promise = (async () => {
    const stopRequests = await listen<Record<string, unknown>>(ASKPASS_EVENT, (event) => {
      void handleAskpassRequest(event.payload);
    });
    const stopResolved = await listen<Record<string, unknown>>(ASKPASS_RESOLVED_EVENT, (event) => {
      const { sessionId, requestId } = event.payload ?? {};
      if (typeof sessionId === "string" && typeof requestId === "string") {
        dismissAskpassRequest(sessionId, requestId);
      }
    });
    const dispose = () => {
      stopRequests();
      stopResolved();
    };
    if (startedGeneration !== generation) {
      // Stopped while subscribing: do not leave listeners behind.
      dispose();
      return;
    }
    unlisten = dispose;
  })();
  startPromise = promise;
  startGeneration = startedGeneration;

  try {
    await promise;
  } finally {
    if (startPromise === promise) {
      startPromise = null;
    }
  }
}

/** Stop listening for askpass credential requests. */
export async function stopGitAskpassBridge(): Promise<void> {
  generation += 1;
  if (unlisten) {
    const dispose = unlisten;
    unlisten = null;
    dispose();
  }
}
