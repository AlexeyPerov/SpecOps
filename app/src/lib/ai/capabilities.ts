export type WorkspaceAccessStatus = "ready" | "blocked" | "unknown";

export enum WorkspaceAccessReason {
  Unknown = "unknown",
  MissingProviderConfig = "missing_provider_config",
  WorkspacePathInaccessible = "workspace_path_inaccessible",
  ProviderUnsupported = "provider_unsupported",
}

export interface ProviderCapabilities {
  canReadWorkspaceFiles: boolean;
  supportedModes: string[];
}

export interface CapabilityCheckResult {
  status: WorkspaceAccessStatus;
  reason: WorkspaceAccessReason;
  capabilities: ProviderCapabilities | null;
  message: string;
  recoveryHint?: string;
}

export interface CapabilityCheckInput {
  provider: string;
  mode: string;
  workspaceRootPath: string | null;
  connectionId?: string;
}

export interface CapabilityChecker {
  checkCapabilities(input: CapabilityCheckInput): Promise<CapabilityCheckResult>;
}

export interface WorkspaceReadinessResult {
  ready: boolean;
  message: string;
  recoveryHint?: string;
}

export interface WorkspaceReadinessChecker {
  checkReadiness(workspaceRootPath: string): WorkspaceReadinessResult;
}
