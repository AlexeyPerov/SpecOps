import type { ProviderRequestPayload } from "./types";

export interface OpenAiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Maps shared provider payload to OpenAI-compatible chat messages. */
export function buildOpenAiChatMessages(payload: ProviderRequestPayload): OpenAiChatMessage[] {
  const systemParts: string[] = [];
  const systemPrompt = payload.systemPrompt?.trim();
  if (systemPrompt) {
    systemParts.push(systemPrompt);
  }

  systemParts.push(`Workspace: ${payload.workspace.name} (${payload.workspace.rootPath})`);

  const summary = payload.summary?.trim();
  if (summary) {
    systemParts.push(`Earlier conversation summary:\n${summary}`);
  }

  return [
    { role: "system", content: systemParts.join("\n\n") },
    ...payload.history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
}
