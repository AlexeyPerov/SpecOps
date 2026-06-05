import type { ChatThreadSnapshot } from "../../domain/contracts";
import {
  buildProviderRequest,
  buildProviderRequestFromThread,
  type ProviderRequestPayload,
} from "../providers/types";
import { resolveModeSystemPrompt } from "./builtins";

/**
 * Shared prompt payload for Debug diagnostics and HTTP adapter input.
 * Resolves the active mode system prompt and thread context in one call.
 */
export function buildThreadProviderRequest(
  thread: ChatThreadSnapshot,
  workspaceRootPath: string,
): ProviderRequestPayload {
  return buildProviderRequestFromThread(
    thread,
    workspaceRootPath,
    resolveModeSystemPrompt(thread.metadata.mode),
  );
}

/** Ensures manual prompt assembly matches the shared thread builder. */
export function buildProviderRequestWithMode(
  input: Parameters<typeof buildProviderRequest>[0],
): ProviderRequestPayload {
  return buildProviderRequest({
    ...input,
    systemPrompt: resolveModeSystemPrompt(input.mode),
  });
}
