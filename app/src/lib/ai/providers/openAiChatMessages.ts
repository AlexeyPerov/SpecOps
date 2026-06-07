import type { ProviderRequestPayload } from "./types";

export interface OpenAiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Maps shared provider payload to OpenAI-compatible chat messages. */
export function buildOpenAiChatMessages(payload: ProviderRequestPayload): OpenAiChatMessage[] {
  const systemPrompt = payload.systemPrompt?.trim() ?? "";

  return [
    { role: "system", content: systemPrompt },
    ...payload.history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
}
