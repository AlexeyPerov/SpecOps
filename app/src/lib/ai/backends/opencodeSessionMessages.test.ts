import { describe, expect, it } from "vitest";
import {
  mapSessionMessageEntry,
  mapSessionMessages,
} from "./opencodeSessionMessages";

describe("opencodeSessionMessages.mapper", () => {
  describe("mapSessionMessageEntry", () => {
    it("maps a user message with text part", () => {
      const entry = {
        info: {
          id: "msg-user-1",
          sessionID: "sess-1",
          role: "user",
          time: { created: 1_750_000_000_000 },
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
        },
        parts: [{ type: "text", text: "hello world" }],
      };

      const result = mapSessionMessageEntry(entry);
      expect(result).toEqual({
        id: "msg-user-1",
        role: "user",
        content: "hello world",
        createdAt: new Date(1_750_000_000_000).toISOString(),
        parts: [{ type: "text", text: "hello world" }],
      });
    });

    it("maps an assistant message with reasoning + text parts and a trailing cost part", () => {
      const entry = {
        info: {
          id: "msg-asst-1",
          sessionID: "sess-1",
          role: "assistant",
          time: { created: 1_750_000_001_000, completed: 1_750_000_002_000 },
          parentID: "msg-user-1",
          modelID: "claude-sonnet-4",
          providerID: "anthropic",
          mode: "primary",
          agent: "build",
          path: { cwd: "/repo", root: "/repo" },
          cost: 0.042,
          tokens: {
            input: 100,
            output: 50,
            reasoning: 20,
            cache: { read: 10, write: 5 },
          },
        },
        parts: [
          { id: "r-1", type: "reasoning", text: "thinking..." },
          { id: "t-1", type: "text", text: "the answer" },
        ],
      };

      const result = mapSessionMessageEntry(entry);
      expect(result).toEqual({
        id: "msg-asst-1",
        role: "assistant",
        content: "the answer",
        createdAt: new Date(1_750_000_001_000).toISOString(),
        parts: [
          { id: "r-1", type: "reasoning", text: "thinking..." },
          { id: "t-1", type: "text", text: "the answer" },
          {
            type: "cost",
            cost: 0.042,
            tokens: {
              input: 100,
              output: 50,
              reasoning: 20,
              cache: { read: 10, write: 5 },
            },
          },
        ],
      });
    });

    it("maps subtask part preserving agent / description / prompt", () => {
      const entry = {
        info: assistantInfo("msg-asst-2"),
        parts: [
          {
            id: "st-1",
            type: "subtask",
            agent: "explore",
            description: "find usages",
            prompt: "search codebase",
          },
        ],
      };

      const result = mapSessionMessageEntry(entry);
      expect(result?.parts).toContainEqual({
        type: "subtask",
        id: "st-1",
        agent: "explore",
        description: "find usages",
        prompt: "search codebase",
        status: "running",
        output: undefined,
        error: undefined,
      });
    });

    it("maps step-start and step-finish parts with sequential step indices", () => {
      const entry = {
        info: assistantInfo("msg-asst-3"),
        parts: [
          { id: "ss-1", type: "step-start" },
          {
            id: "sf-1",
            type: "step-finish",
            reason: "stop",
            cost: 0.01,
            tokens: {
              input: 1,
              output: 2,
              reasoning: 3,
              cache: { read: 4, write: 5 },
            },
          },
          { id: "ss-2", type: "step-start" },
          {
            id: "sf-2",
            type: "step-finish",
            reason: "end_turn",
            cost: 0.02,
            tokens: {
              input: 10,
              output: 20,
              reasoning: 30,
              cache: { read: 40, write: 50 },
            },
          },
        ],
      };

      const result = mapSessionMessageEntry(entry);
      const stepParts = result?.parts?.filter((part) => part.type === "step");
      expect(stepParts).toEqual([
        { type: "step", id: "ss-1", phase: "start", index: 0 },
        {
          type: "step",
          id: "sf-1",
          phase: "finish",
          index: 0,
          reason: "stop",
          cost: 0.01,
          tokens: {
            input: 1,
            output: 2,
            reasoning: 3,
            cache: { read: 4, write: 5 },
          },
        },
        { type: "step", id: "ss-2", phase: "start", index: 1 },
        {
          type: "step",
          id: "sf-2",
          phase: "finish",
          index: 1,
          reason: "end_turn",
          cost: 0.02,
          tokens: {
            input: 10,
            output: 20,
            reasoning: 30,
            cache: { read: 40, write: 50 },
          },
        },
      ]);
    });

    it("maps file, snapshot, patch, and compaction parts", () => {
      const entry = {
        info: assistantInfo("msg-asst-4"),
        parts: [
          { id: "f-1", type: "file", mime: "image/png", filename: "shot.png", url: "file:///x" },
          { id: "snap-1", type: "snapshot", snapshot: "abc123" },
          { id: "patch-1", type: "patch", hash: "def456", files: ["a.ts", "b.ts"] },
          { id: "comp-1", type: "compaction", auto: true },
        ],
      };

      const result = mapSessionMessageEntry(entry);
      expect(result?.parts).toEqual([
        { type: "file", id: "f-1", mime: "image/png", filename: "shot.png", url: "file:///x" },
        { type: "diff", id: "snap-1", snapshot: "abc123" },
        { type: "diff", id: "patch-1", snapshot: "def456", files: ["a.ts", "b.ts"] },
        { type: "compaction", id: "comp-1", auto: true },
        // Trailing cost part appended from assistant info tokens/cost
        {
          type: "cost",
          cost: 0.042,
          tokens: {
            input: 100,
            output: 50,
            reasoning: 20,
            cache: { read: 10, write: 5 },
          },
        },
      ]);
    });

    it("derives toolCalls from tool parts", () => {
      const entry = {
        info: assistantInfo("msg-asst-5"),
        parts: [
          {
            id: "tool-1",
            type: "tool",
            callID: "call-1",
            tool: "read_file",
            state: {
              status: "completed",
              input: { path: "a.ts" },
              output: "file contents",
              title: "read",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          },
          {
            id: "tool-2",
            type: "tool",
            callID: "call-2",
            tool: "write_file",
            state: {
              status: "error",
              input: { path: "b.ts" },
              error: "permission denied",
              metadata: {},
              time: { start: 3, end: 4 },
            },
          },
          {
            id: "tool-3",
            type: "tool",
            callID: "call-3",
            tool: "list",
            state: { status: "running", input: {}, time: { start: 5 } },
          },
        ],
      };

      const result = mapSessionMessageEntry(entry);
      expect(result?.toolCalls).toEqual([
        {
          callId: "call-1",
          toolName: "read_file",
          status: "success",
          input: { path: "a.ts" },
          output: "file contents",
        },
        {
          callId: "call-2",
          toolName: "write_file",
          status: "failure",
          input: { path: "b.ts" },
        },
        { callId: "call-3", toolName: "list", status: "pending", input: {} },
      ]);
    });

    it("drops unsupported part types (tool, agent, retry) from parts but keeps toolCalls", () => {
      const entry = {
        info: assistantInfo("msg-asst-6"),
        parts: [
          { id: "text-1", type: "text", text: "hi" },
          { id: "agent-1", type: "agent", name: "explore" },
          { id: "retry-1", type: "retry", attempt: 1, error: { name: "APIError", data: {} } },
          {
            id: "tool-1",
            type: "tool",
            callID: "call-1",
            tool: "x",
            state: { status: "completed", input: {}, output: "", title: "t", metadata: {}, time: { start: 1, end: 2 } },
          },
        ],
      };

      const result = mapSessionMessageEntry(entry);
      const partTypes = result?.parts?.map((part) => part.type);
      expect(partTypes).toEqual(["text", "cost"]);
      expect(result?.toolCalls).toEqual([
        { callId: "call-1", toolName: "x", status: "success", input: {}, output: "" },
      ]);
    });

    it("returns null when info is missing", () => {
      expect(mapSessionMessageEntry({ parts: [] })).toBeNull();
      expect(mapSessionMessageEntry(null)).toBeNull();
    });

    it("returns null when role is missing or invalid", () => {
      expect(
        mapSessionMessageEntry({
          info: { id: "m1", time: { created: 1 } },
          parts: [],
        }),
      ).toBeNull();
    });

    it("returns null when id is missing", () => {
      expect(
        mapSessionMessageEntry({
          info: { role: "user", time: { created: 1 } },
          parts: [],
        }),
      ).toBeNull();
    });

    it("returns null when createdAt cannot be resolved", () => {
      expect(
        mapSessionMessageEntry({
          info: { id: "m1", role: "user" },
          parts: [],
        }),
      ).toBeNull();
    });

    it("treats unknown OpenCode roles (e.g. synthetic) as system messages", () => {
      const entry = {
        info: {
          id: "msg-syn-1",
          sessionID: "sess-1",
          role: "synthetic",
          time: { created: 1_750_000_000_000 },
        },
        parts: [{ id: "t-1", type: "text", text: "context injected" }],
      };

      const result = mapSessionMessageEntry(entry);
      expect(result?.role).toBe("system");
      expect(result?.content).toBe("context injected");
    });

    it("falls back to summary body when assistant has no text parts", () => {
      const entry = {
        info: {
          ...assistantInfo("msg-asst-empty"),
          summary: { title: "t", body: "summary text", diffs: [] },
        },
        parts: [],
      };

      const result = mapSessionMessageEntry(entry);
      expect(result?.content).toBe("summary text");
    });

    it("preserves createdAt when provided as ISO string", () => {
      const entry = {
        info: {
          id: "msg-user-iso",
          sessionID: "sess-1",
          role: "user",
          time: { created: "2026-06-15T10:00:00.000Z" },
        },
        parts: [{ type: "text", text: "hi" }],
      };

      expect(mapSessionMessageEntry(entry)?.createdAt).toBe("2026-06-15T10:00:00.000Z");
    });
  });

  describe("mapSessionMessages", () => {
    it("maps a sequence of entries and drops malformed ones", () => {
      const entries = [
        {
          info: {
            id: "u1",
            sessionID: "s",
            role: "user",
            time: { created: 1 },
          },
          parts: [{ type: "text", text: "q" }],
        },
        null,
        { info: null, parts: [] },
        {
          info: {
            id: "a1",
            sessionID: "s",
            role: "assistant",
            time: { created: 2 },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          parts: [{ type: "text", text: "a" }],
        },
      ];

      const result = mapSessionMessages(entries);
      expect(result.map((message) => message.id)).toEqual(["u1", "a1"]);
      expect(result[1]?.parts?.at(-1)).toMatchObject({ type: "cost", cost: 0 });
    });

    it("returns empty array when all entries are malformed", () => {
      expect(mapSessionMessages([null, "nope", {}])).toEqual([]);
    });
  });
});

function assistantInfo(id: string) {
  return {
    id,
    sessionID: "sess-1",
    role: "assistant" as const,
    time: { created: 1_750_000_001_000 },
    parentID: "msg-parent",
    modelID: "claude-sonnet-4",
    providerID: "anthropic",
    mode: "primary",
    agent: "build",
    path: { cwd: "/repo", root: "/repo" },
    cost: 0.042,
    tokens: {
      input: 100,
      output: 50,
      reasoning: 20,
      cache: { read: 10, write: 5 },
    },
  };
}
