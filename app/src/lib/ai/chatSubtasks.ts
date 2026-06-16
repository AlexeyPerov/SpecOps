import type { ChatMessage, ChatSubtaskPart, ChatSubtaskStatus } from "../domain/contracts";

/**
 * Extracted subtask shown beneath an assistant message.
 *
 * OpenCode emits one `subtask` part per sub-agent invocation; unlike reasoning
 * we keep them separate (one card per sub-agent) rather than joining, because
 * each subtask has its own agent, status, and output.
 */
export interface MessageSubtask {
  /** Stable id for keyed rendering; falls back to `messageId:subtask:index`. */
  id: string;
  /** Sub-agent name (e.g. the OpenCode agent id). */
  agent: string;
  description?: string;
  prompt?: string;
  status: ChatSubtaskStatus;
  output?: string;
  error?: string;
}

/**
 * Returns the subtask parts for a message, in arrival order. Returns an empty
 * array when the message has no parts or no subtask parts. Subtasks with only
 * whitespace agent names are dropped (malformed); a subtask with a real agent
 * name but no description/output is still meaningful (e.g. a running sub-agent)
 * so it is kept.
 */
export function extractMessageSubtasks(message: ChatMessage): MessageSubtask[] {
  const parts = message.parts;
  if (!parts || parts.length === 0) {
    return [];
  }

  const subtasks: MessageSubtask[] = [];
  parts.forEach((part, index) => {
    if (!isSubtaskPart(part)) {
      return;
    }
    const agent = part.agent.trim();
    if (agent.length === 0) {
      return;
    }
    subtasks.push({
      id: part.id && part.id.length > 0 ? part.id : `${message.id}:subtask:${index}`,
      agent,
      ...(part.description ? { description: part.description } : {}),
      ...(part.prompt ? { prompt: part.prompt } : {}),
      status: part.status,
      ...(part.output ? { output: part.output } : {}),
      ...(part.error ? { error: part.error } : {}),
    });
  });
  return subtasks;
}

function isSubtaskPart(part: { type: unknown }): part is ChatSubtaskPart {
  return part.type === "subtask";
}
