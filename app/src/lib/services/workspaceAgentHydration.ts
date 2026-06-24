import { chatStore } from "../state/chatStore";
import {
  WorkspaceAgentBackendError,
  type WorkspaceAgentBackend,
} from "../ai/backends/workspaceAgentBackend";
import { mapSessionMessages } from "../ai/backends/opencodeSessionMessages";
import { mappedSessionForId } from "./workspaceAgentSession";
import type { SessionIndexEntry } from "../domain/contracts";

/**
 * M1-T3 hydration: replaces the local-only thread snapshot with the OpenCode
 * `session.messages` payload as the display source of truth for each session
 * tab that has a linked OpenCode session. Local snapshot remains as offline
 * cache / fallback (per Q3 decision). Failures are non-fatal — the local
 * snapshot stays in place if hydration can't reach the server.
 *
 * The `agents` parameter name is retained because the field is sourced from
 * `chatStore.getSessionIndex()`; each entry is a workspace session.
 */
export async function hydrateWorkspaceAgentMessages(input: {
  backend: WorkspaceAgentBackend;
  workspaceRootPath: string;
  agents: readonly SessionIndexEntry[];
}): Promise<void> {
  const { backend, workspaceRootPath, agents } = input;
  await Promise.all(
    agents.map(async (entry) => {
      const mapping = mappedSessionForId(agents, entry.id);
      if (!mapping) {
        return;
      }
      try {
        const entries = await backend.listMessages({
          workspaceRootPath,
          sessionId: mapping.opencodeSessionId,
        });
        const messages = mapSessionMessages(entries);
        if (messages.length === 0) {
          return;
        }
        chatStore.setThreadMessages(messages, entry.id, workspaceRootPath);
      } catch (error: unknown) {
        if (
          error instanceof WorkspaceAgentBackendError &&
          (error.code === "serverUnavailable" ||
            error.code === "transportError" ||
            error.code === "authFailure" ||
            error.code === "notFound")
        ) {
          return;
        }
        throw error;
      }
    }),
  );
}
