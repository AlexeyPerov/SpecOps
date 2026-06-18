/**
 * Client-side queued-prompt manager (M3-T5).
 *
 * When a turn is already running, the composer offers two delivery modes
 * (per [questions.md Q11](../../specs/ops/phase-3.5/questions.md) and the
 * execution-plan-m3 M3-T5 description):
 *
 *   - **queue**: deliver the prompt after the running turn completes.
 *   - **steer**: interrupt the running turn and append the new prompt.
 *
 * The manager is intentionally framework-agnostic — it owns the queued item
 * list and exposes simple accessors. The composer (Svelte) binds these to the
 * `$state` arrays for chip rendering.
 */

import type { WorkspaceAgentSendContext } from "./backends/workspaceAgentBackend";
import type { ChatQueueMode } from "./chatSendPipeline";

export interface QueuedPrompt {
  /** Stable id for keyed chip rendering. */
  id: string;
  prompt: string;
  mode: ChatQueueMode;
  /** Optional assembled composer context (mentions / attachments). */
  context?: WorkspaceAgentSendContext;
  /** ISO timestamp when the user queued the prompt. */
  queuedAt: string;
}

export interface ComposerPromptQueueSnapshot {
  items: QueuedPrompt[];
}

let queueCounter = 0;

function nextQueueId(): string {
  queueCounter += 1;
  return `queued-${Date.now()}-${queueCounter}`;
}

/**
 * Creates a tiny reactive-friendly queue. The snapshot is returned by value so
 * a Svelte `$state` proxy can hold it and react to replacement.
 */
export function createComposerPromptQueue(): {
  snapshot(): ComposerPromptQueueSnapshot;
  enqueue(input: {
    prompt: string;
    mode: ChatQueueMode;
    context?: WorkspaceAgentSendContext;
  }): QueuedPrompt | null;
  remove(id: string): void;
  clear(): void;
  /** Pops the next queue-mode item to deliver after the running turn ends. */
  takeNextDeliverable(): QueuedPrompt | null;
  /** Pops the next steer-mode item (delivered when the user chooses to steer). */
  takeNextSteer(): QueuedPrompt | null;
} {
  let items: QueuedPrompt[] = [];

  return {
    snapshot() {
      return { items: [...items] };
    },
    enqueue(input) {
      const trimmed = input.prompt.trim();
      if (trimmed.length === 0) {
        return null;
      }
      const entry: QueuedPrompt = {
        id: nextQueueId(),
        prompt: trimmed,
        mode: input.mode,
        ...(input.context ? { context: input.context } : {}),
        queuedAt: new Date().toISOString(),
      };
      items = [...items, entry];
      return entry;
    },
    remove(id) {
      items = items.filter((item) => item.id !== id);
    },
    clear() {
      items = [];
    },
    takeNextDeliverable() {
      const idx = items.findIndex((item) => item.mode === "queue");
      if (idx < 0) {
        return null;
      }
      const [item] = items.splice(idx, 1);
      return item ?? null;
    },
    takeNextSteer() {
      const idx = items.findIndex((item) => item.mode === "steer");
      if (idx < 0) {
        return null;
      }
      const [item] = items.splice(idx, 1);
      return item ?? null;
    },
  };
}

/**
 * Returns the suggested default queue mode for a prompt sent while a turn is
 * running. The recommendation is `queue` (non-destructive, run after the
 * current turn) — `steer` is opt-in because it interrupts the running turn.
 */
export function defaultQueueMode(): ChatQueueMode {
  return "queue";
}
