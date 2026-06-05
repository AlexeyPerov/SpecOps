import { ChatProviderError } from "./errors";

interface OpenAiStreamChunk {
  choices?: Array<{
    delta?: {
      content?: unknown;
      text?: unknown;
    };
    message?: {
      content?: unknown;
    };
    text?: unknown;
  }>;
  content?: unknown;
  error?: {
    message?: unknown;
  };
}

const DONE_SENTINEL = "[DONE]";

export async function* parseOpenAiSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const events = splitCompleteSseEvents(buffer);
      buffer = events.remainder;
      for (const event of events.completeEvents) {
        const result = parseSseEvent(event);
        if (result.done) {
          sawDone = true;
          return;
        }
        if (result.delta) {
          yield result.delta;
        }
      }
    }
  } catch (error) {
    if (error instanceof ChatProviderError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : "Stream read failed";
    throw new ChatProviderError(
      `HTTP provider stream failed: ${detail}`,
      "HTTP provider stream failed while reading the response. Try again.",
    );
  } finally {
    reader.releaseLock();
  }

  buffer += decoder.decode();
  const finalEvent = buffer.trim();
  if (finalEvent) {
    const result = parseSseEvent(finalEvent);
    if (result.done) {
      sawDone = true;
    } else if (result.delta) {
      yield result.delta;
    }
  }

  if (!sawDone) {
    throw new ChatProviderError(
      "HTTP provider stream ended before [DONE].",
      "HTTP provider stream ended unexpectedly. Try again.",
    );
  }
}

function splitCompleteSseEvents(input: string): {
  completeEvents: string[];
  remainder: string;
} {
  const completeEvents: string[] = [];
  let start = 0;
  const separatorPattern = /\r\n\r\n|\n\n|\r\r/g;

  for (const match of input.matchAll(separatorPattern)) {
    completeEvents.push(input.slice(start, match.index));
    start = match.index + match[0].length;
  }

  return {
    completeEvents,
    remainder: input.slice(start),
  };
}

function parseSseEvent(event: string): { done: boolean; delta: string | null } {
  const dataLines = event
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith(":"))
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());

  if (dataLines.length === 0) {
    return { done: false, delta: null };
  }

  const data = dataLines.join("\n").trim();
  if (data === DONE_SENTINEL) {
    return { done: true, delta: null };
  }

  let parsed: OpenAiStreamChunk;
  try {
    parsed = JSON.parse(data) as OpenAiStreamChunk;
  } catch {
    throw new ChatProviderError(
      "HTTP provider returned malformed SSE JSON.",
      "HTTP provider returned an invalid streaming response. Try again.",
    );
  }

  const streamError = readString(parsed.error?.message);
  if (streamError) {
    throw new ChatProviderError(streamError, sanitizeApiErrorMessage(streamError));
  }

  return {
    done: false,
    delta: extractDelta(parsed),
  };
}

function extractDelta(chunk: OpenAiStreamChunk): string | null {
  const choice = chunk.choices?.[0];
  return (
    readString(choice?.delta?.content) ??
    readString(choice?.delta?.text) ??
    readString(choice?.text) ??
    readString(choice?.message?.content) ??
    readString(chunk.content)
  );
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sanitizeApiErrorMessage(message: string): string {
  return message.replace(/Bearer\s+\S+/gi, "[redacted]").trim();
}
