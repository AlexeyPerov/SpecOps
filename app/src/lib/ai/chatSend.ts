import type { ChatProvider, ProviderSendRequest } from "./providers/types";
import { ChatProviderError } from "./providers/errors";

export async function streamProviderMessage(
  provider: ChatProvider,
  request: ProviderSendRequest,
  onChunk?: (delta: string, accumulated: string) => void,
): Promise<string> {
  if (provider.streamMessage) {
    let accumulated = "";
    for await (const chunk of provider.streamMessage(request)) {
      accumulated += chunk.delta;
      onChunk?.(chunk.delta, accumulated);
    }
    return accumulated;
  }

  const response = await provider.sendMessage(request);
  onChunk?.(response.content, response.content);
  return response.content;
}

export function isChatProviderError(error: unknown): error is ChatProviderError {
  return error instanceof ChatProviderError;
}

export { ChatProviderError };
