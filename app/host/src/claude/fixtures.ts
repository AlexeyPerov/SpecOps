import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  Query,
  Options,
  SessionMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeSessionDriver } from "./session";
/** Deterministic pinned SDK contract fixtures. No credential or inference required. */
export class ClaudeFixtureDriver implements ClaudeSessionDriver {
  readonly calls: Options[] = [];
  closed = 0;
  constructor(readonly path: string) {}
  private db(): Record<string, SessionMessage[]> {
    return existsSync(this.path)
      ? JSON.parse(readFileSync(this.path, "utf8"))
      : {};
  }
  async history(id: string) {
    const db = this.db();
    return { exists: !!db[id], messages: db[id] ?? [] };
  }
  async query(input: {
    prompt: AsyncIterable<SDKUserMessage>;
    options: Options;
  }): Promise<Query> {
    this.calls.push(input.options);
    let closed = false;
    const self = this;
    const q = {
      supportedModels: async () => [
        { value: "native-model", displayName: "Native model" },
      ],
      close() {
        closed = true;
        self.closed++;
      },
      async *[Symbol.asyncIterator]() {
        const first = await input.prompt[Symbol.asyncIterator]().next();
        if (first.done || closed) return;
        const user = first.value;
        const session = input.options.resume ?? input.options.sessionId!;
        const db = self.db();
        if (input.options.resume && !db[session])
          throw new Error("Native session missing");
        db[session] ??= [];
        db[session].push({
          ...user,
          uuid: user.uuid!,
          session_id: session,
          parent_agent_id: null,
        });
        const save = () => {
          mkdirSync(dirname(self.path), { recursive: true });
          writeFileSync(self.path, JSON.stringify(db));
        };
        save();
        const prompt = user.message.content;
        const base = { session_id: session, user_message_uuid: user.uuid };
        yield {
          ...base,
          type: "system",
          subtype: "init",
          uuid: "init",
          cwd: input.options.cwd,
          tools: [],
          model: input.options.model,
        };
        if (prompt === "cancel" || prompt === "hang") {
          await new Promise<void>((resolve) => {
            if (input.options.abortController!.signal.aborted) return resolve();
            input.options.abortController!.signal.addEventListener(
              "abort",
              () => resolve(),
              { once: true },
            );
          });
          return;
        }
        yield {
          ...base,
          type: "system",
          subtype: "future",
          uuid: "unknown",
          data: {
            token: "contract-token-canary",
            Authorization: "Bearer contract-bearer-canary",
            secret: "contract-secret-canary",
          },
        };
        yield { ...base, type: "stream_event", event: {}, uuid: "malformed" };
        const messageId = `assistant-${user.uuid}`;
        yield {
          ...base,
          type: "stream_event",
          uuid: "start",
          event: { type: "message_start", message: { id: messageId } },
        };
        const text =
          prompt === "secret"
            ? "api_key=fixture-private-key-canary private"
            : "Native fixture answer";
        for (const chunk of [
          text.slice(0, 9),
          text.slice(9, 20),
          text.slice(20),
        ])
          yield {
            ...base,
            type: "stream_event",
            uuid: "delta",
            event: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: chunk },
            },
          };
        const assistant = {
          type: "assistant" as const,
          uuid: messageId,
          session_id: session,
          parent_tool_use_id: null,
          parent_agent_id: null,
          message: {
            id: messageId,
            role: "assistant",
            content: [
              { type: "text", text },
              { type: "thinking", thinking: "Native reasoning" },
              {
                type: "tool_use",
                id: `tool-${user.uuid}`,
                name: "Read",
                input: { path: "README.md" },
              },
            ],
            stop_reason: prompt === "interrupt" ? null : "end_turn",
          },
        };
        db[session].push(assistant);
        save();
        yield { ...base, ...assistant };
        const tool = {
          type: "user" as const,
          uuid: `tool-result-${user.uuid}`,
          session_id: session,
          parent_tool_use_id: null,
          parent_agent_id: null,
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: `tool-${user.uuid}`,
                content: "File content",
                is_error: false,
              },
            ],
          },
        };
        db[session].push(tool);
        save();
        yield tool;
        if (prompt === "interrupt")
          throw new Error(
            "Credential fixture-private-key-canary private failure",
          );
        if (prompt === "capacity") {
          for (let i = 0; i < 10000; i++)
            yield {
              ...base,
              type: "future",
              uuid: `future-${i}`,
              data: "x".repeat(65536),
            };
          return;
        }
        yield {
          ...base,
          type: "result",
          uuid: `result-${user.uuid}`,
          subtype: prompt === "fail" ? "error_during_execution" : "success",
          is_error: prompt === "fail",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 2,
          },
          total_cost_usd:
            db[session].filter((m) => m.type === "assistant").length * 0.125,
        };
      },
    };
    return q as unknown as Query;
  }
}
export function fixturePath(profileRoot: string) {
  return join(profileRoot, "fixture-history.json");
}
