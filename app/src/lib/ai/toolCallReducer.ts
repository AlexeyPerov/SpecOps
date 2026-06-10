import type { ToolCallRecord, ToolCallStatus } from "../domain/contracts";

export function applyToolStarted(
  toolCalls: ToolCallRecord[],
  event: { toolName: string; callId: string | null; input: unknown },
): ToolCallRecord[] {
  const callId = event.callId ?? "";
  const existing = toolCalls.find((tc) => tc.callId === callId);
  if (existing) {
    if (existing.status !== "pending") {
      return toolCalls;
    }
    return toolCalls.map((tc) =>
      tc.callId === callId
        ? { ...tc, toolName: event.toolName, input: event.input ?? tc.input }
        : tc,
    );
  }
  return [
    ...toolCalls,
    {
      callId,
      toolName: event.toolName,
      status: "pending" as ToolCallStatus,
      input: event.input,
    },
  ];
}

export function applyToolCompleted(
  toolCalls: ToolCallRecord[],
  event: {
    toolName: string;
    callId: string | null;
    output: unknown;
    isError: boolean;
  },
): ToolCallRecord[] {
  const callId = event.callId ?? "";
  const existing = toolCalls.find((tc) => tc.callId === callId);
  if (existing) {
    if (existing.status !== "pending") {
      return toolCalls.map((tc) =>
        tc.callId === callId
          ? {
              ...tc,
              status: event.isError ? ("failure" as ToolCallStatus) : ("success" as ToolCallStatus),
              output: event.output,
            }
          : tc,
      );
    }
    return toolCalls.map((tc) =>
      tc.callId === callId
        ? {
            ...tc,
            status: event.isError ? ("failure" as ToolCallStatus) : ("success" as ToolCallStatus),
            toolName: event.toolName,
            output: event.output,
          }
        : tc,
    );
  }
  return [
    ...toolCalls,
    {
      callId,
      toolName: event.toolName,
      status: event.isError ? ("failure" as ToolCallStatus) : ("success" as ToolCallStatus),
      output: event.output,
    },
  ];
}

export function applyToolProgress(
  toolCalls: ToolCallRecord[],
  event: { toolName: string; callId: string | null; output: unknown },
): ToolCallRecord[] {
  const callId = event.callId ?? "";
  const existing = toolCalls.find((tc) => tc.callId === callId);
  if (existing) {
    return toolCalls.map((tc) =>
      tc.callId === callId ? { ...tc, progress: event.output } : tc,
    );
  }
  return [
    ...toolCalls,
    {
      callId,
      toolName: event.toolName,
      status: "pending" as ToolCallStatus,
      progress: event.output,
    },
  ];
}
