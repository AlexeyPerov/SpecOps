import { describe, expect, it } from "vitest";
import { ChatProviderError } from "./errors";
import { parseOpenAiSseStream } from "./openAiSseParser";

async function collectDeltas(chunks: string[]): Promise<string[]> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  const deltas: string[] = [];
  for await (const delta of parseOpenAiSseStream(stream)) {
    deltas.push(delta);
  }
  return deltas;
}

describe("parseOpenAiSseStream", () => {
  it("parses OpenAI-compatible SSE chunks into ordered deltas", async () => {
    await expect(
      collectDeltas([
        ': keepalive\n\n',
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    ).resolves.toEqual(["Hel", "lo"]);
  });

  it("handles CRLF framing and deltas split across transport chunks", async () => {
    await expect(
      collectDeltas([
        'data: {"choices":[{"delta":{"content":"A"}}]}\r\n\r\n',
        'data: {"choices":[{"delta":{"content":"B"',
        "}}]}\r\n\r\n",
        "data: [DONE]\r\n\r\n",
      ]),
    ).resolves.toEqual(["A", "B"]);
  });

  it("accepts compatible delta aliases", async () => {
    await expect(
      collectDeltas([
        'data: {"choices":[{"delta":{"text":"one"}}]}\n\n',
        'data: {"choices":[{"text":"two"}]}\n\n',
        'data: {"choices":[{"message":{"content":"three"}}]}\n\n',
        'data: {"content":"four"}\n\n',
        "data: [DONE]\n\n",
      ]),
    ).resolves.toEqual(["one", "two", "three", "four"]);
  });

  it("maps malformed JSON to a ChatProviderError", async () => {
    await expect(collectDeltas(["data: {bad-json}\n\n", "data: [DONE]\n\n"])).rejects.toMatchObject({
      name: "ChatProviderError",
      userMessage: "HTTP provider returned an invalid streaming response. Try again.",
    });
  });

  it("maps in-band stream errors to ChatProviderError", async () => {
    await expect(
      collectDeltas(['data: {"error":{"message":"Bearer secret rejected"}}\n\n', "data: [DONE]\n\n"]),
    ).rejects.toMatchObject({
      name: "ChatProviderError",
      message: "Bearer secret rejected",
      userMessage: "[redacted] rejected",
    });
  });

  it("rejects truncated streams without a DONE terminator", async () => {
    await expect(
      collectDeltas(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']),
    ).rejects.toBeInstanceOf(ChatProviderError);
  });
});
