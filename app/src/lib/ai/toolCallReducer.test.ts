import { describe, expect, it } from "vitest";
import {
  applyToolCompleted,
  applyToolProgress,
  applyToolStarted,
} from "./toolCallReducer";
import type { ToolCallRecord } from "../domain/contracts";

describe("toolCallReducer", () => {
  describe("applyToolStarted", () => {
    it("adds a new pending tool call", () => {
      const result = applyToolStarted([], {
        toolName: "read_file",
        callId: "call-1",
        input: { path: "a.ts" },
      });
      expect(result).toEqual([
        {
          callId: "call-1",
          toolName: "read_file",
          status: "pending",
          input: { path: "a.ts" },
        },
      ]);
    });

    it("does not duplicate when same callId started twice", () => {
      const initial = applyToolStarted([], {
        toolName: "read_file",
        callId: "call-1",
        input: { path: "a.ts" },
      });
      const result = applyToolStarted(initial, {
        toolName: "read_file",
        callId: "call-1",
        input: { path: "b.ts" },
      });
      expect(result).toHaveLength(1);
      expect(result[0].callId).toBe("call-1");
    });

    it("updates input on existing pending call when missing", () => {
      const initial: ToolCallRecord[] = [
        { callId: "call-1", toolName: "read_file", status: "pending" },
      ];
      const result = applyToolStarted(initial, {
        toolName: "read_file",
        callId: "call-1",
        input: { path: "new.ts" },
      });
      expect(result).toEqual([
        {
          callId: "call-1",
          toolName: "read_file",
          status: "pending",
          input: { path: "new.ts" },
        },
      ]);
    });

    it("does not overwrite terminal state on repeated started", () => {
      const initial: ToolCallRecord[] = [
        {
          callId: "call-1",
          toolName: "read_file",
          status: "success",
          output: "ok",
        },
      ];
      const result = applyToolStarted(initial, {
        toolName: "read_file",
        callId: "call-1",
        input: { path: "x.ts" },
      });
      expect(result[0].status).toBe("success");
      expect(result[0].output).toBe("ok");
    });

    it("handles null callId by using empty string", () => {
      const result = applyToolStarted([], {
        toolName: "bash",
        callId: null,
        input: "ls",
      });
      expect(result).toEqual([
        {
          callId: "",
          toolName: "bash",
          status: "pending",
          input: "ls",
        },
      ]);
    });
  });

  describe("applyToolCompleted", () => {
    it("transitions pending to success", () => {
      const initial: ToolCallRecord[] = [
        {
          callId: "call-1",
          toolName: "read_file",
          status: "pending",
          input: { path: "a.ts" },
        },
      ];
      const result = applyToolCompleted(initial, {
        toolName: "read_file",
        callId: "call-1",
        output: "file contents",
        isError: false,
      });
      expect(result).toEqual([
        {
          callId: "call-1",
          toolName: "read_file",
          status: "success",
          input: { path: "a.ts" },
          output: "file contents",
        },
      ]);
    });

    it("transitions pending to failure", () => {
      const initial: ToolCallRecord[] = [
        {
          callId: "call-1",
          toolName: "read_file",
          status: "pending",
          input: { path: "a.ts" },
        },
      ];
      const result = applyToolCompleted(initial, {
        toolName: "read_file",
        callId: "call-1",
        output: "permission denied",
        isError: true,
      });
      expect(result).toEqual([
        {
          callId: "call-1",
          toolName: "read_file",
          status: "failure",
          input: { path: "a.ts" },
          output: "permission denied",
        },
      ]);
    });

    it("creates synthetic placeholder when completed arrives before started", () => {
      const result = applyToolCompleted([], {
        toolName: "write_file",
        callId: "call-2",
        output: { ok: true },
        isError: false,
      });
      expect(result).toEqual([
        {
          callId: "call-2",
          toolName: "write_file",
          status: "success",
          output: { ok: true },
        },
      ]);
    });

    it("overwrites terminal state with latest completed", () => {
      const initial: ToolCallRecord[] = [
        {
          callId: "call-1",
          toolName: "read_file",
          status: "success",
          output: "first",
        },
      ];
      const result = applyToolCompleted(initial, {
        toolName: "read_file",
        callId: "call-1",
        output: "second",
        isError: false,
      });
      expect(result[0].output).toBe("second");
      expect(result[0].status).toBe("success");
    });

    it("overwrites success with failure", () => {
      const initial: ToolCallRecord[] = [
        {
          callId: "call-1",
          toolName: "read_file",
          status: "success",
          output: "ok",
        },
      ];
      const result = applyToolCompleted(initial, {
        toolName: "read_file",
        callId: "call-1",
        output: "error",
        isError: true,
      });
      expect(result[0].status).toBe("failure");
      expect(result[0].output).toBe("error");
    });
  });

  describe("applyToolProgress", () => {
    it("adds progress to existing pending tool call", () => {
      const initial: ToolCallRecord[] = [
        {
          callId: "call-1",
          toolName: "bash",
          status: "pending",
          input: "npm test",
        },
      ];
      const result = applyToolProgress(initial, {
        toolName: "bash",
        callId: "call-1",
        output: { line: "running test 1" },
      });
      expect(result).toEqual([
        {
          callId: "call-1",
          toolName: "bash",
          status: "pending",
          input: "npm test",
          progress: { line: "running test 1" },
        },
      ]);
    });

    it("creates synthetic placeholder when progress arrives before started", () => {
      const result = applyToolProgress([], {
        toolName: "bash",
        callId: "call-3",
        output: { pct: 50 },
      });
      expect(result).toEqual([
        {
          callId: "call-3",
          toolName: "bash",
          status: "pending",
          progress: { pct: 50 },
        },
      ]);
    });

    it("updates progress on subsequent calls", () => {
      const initial: ToolCallRecord[] = [
        {
          callId: "call-1",
          toolName: "bash",
          status: "pending",
          progress: { pct: 25 },
        },
      ];
      const result = applyToolProgress(initial, {
        toolName: "bash",
        callId: "call-1",
        output: { pct: 75 },
      });
      expect(result[0].progress).toEqual({ pct: 75 });
    });
  });

  describe("full lifecycle", () => {
    it("handles start-progress-complete-success flow", () => {
      let calls: ToolCallRecord[] = [];
      calls = applyToolStarted(calls, {
        toolName: "bash",
        callId: "call-1",
        input: "npm test",
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].status).toBe("pending");

      calls = applyToolProgress(calls, {
        toolName: "bash",
        callId: "call-1",
        output: { line: "PASS" },
      });
      expect(calls[0].progress).toEqual({ line: "PASS" });

      calls = applyToolCompleted(calls, {
        toolName: "bash",
        callId: "call-1",
        output: "all tests passed",
        isError: false,
      });
      expect(calls[0].status).toBe("success");
      expect(calls[0].output).toBe("all tests passed");
    });

    it("handles out-of-order completed before started", () => {
      let calls: ToolCallRecord[] = [];
      calls = applyToolCompleted(calls, {
        toolName: "bash",
        callId: "call-1",
        output: "done",
        isError: false,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].status).toBe("success");

      calls = applyToolStarted(calls, {
        toolName: "bash",
        callId: "call-1",
        input: "ls",
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].status).toBe("success");
    });

    it("handles multiple concurrent tool calls", () => {
      let calls: ToolCallRecord[] = [];
      calls = applyToolStarted(calls, {
        toolName: "read_file",
        callId: "call-1",
        input: { path: "a.ts" },
      });
      calls = applyToolStarted(calls, {
        toolName: "read_file",
        callId: "call-2",
        input: { path: "b.ts" },
      });
      expect(calls).toHaveLength(2);

      calls = applyToolCompleted(calls, {
        toolName: "read_file",
        callId: "call-2",
        output: "b contents",
        isError: false,
      });
      expect(calls[0].status).toBe("pending");
      expect(calls[1].status).toBe("success");

      calls = applyToolCompleted(calls, {
        toolName: "read_file",
        callId: "call-1",
        output: "a contents",
        isError: false,
      });
      expect(calls[0].status).toBe("success");
      expect(calls[1].status).toBe("success");
    });
  });
});
