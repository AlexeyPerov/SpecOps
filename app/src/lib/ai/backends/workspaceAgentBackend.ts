export type WorkspaceAgentBackendId = "opencode" | "cursor-local";

export interface WorkspaceAgentSendRequest {
  prompt: string;
  workspaceRootPath: string;
}

export interface WorkspaceAgentBackend {
  readonly id: WorkspaceAgentBackendId;
  send(request: WorkspaceAgentSendRequest): Promise<never>;
}

export class WorkspaceAgentBackendNotImplementedError extends Error {
  constructor(backendId: WorkspaceAgentBackendId) {
    super(
      `Workspace agent backend "${backendId}" is not implemented yet. Planned for phase 3.`,
    );
    this.name = "WorkspaceAgentBackendNotImplementedError";
  }
}

/**
 * Phase 1 stub factory. Real OpenCode/Cursor wiring lands in later phases.
 */
export function createWorkspaceAgentBackend(
  id: WorkspaceAgentBackendId,
): WorkspaceAgentBackend {
  return {
    id,
    async send(_request: WorkspaceAgentSendRequest): Promise<never> {
      throw new WorkspaceAgentBackendNotImplementedError(id);
    },
  };
}
