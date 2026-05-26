import type { DebugProviderSettings } from "../../domain/contracts";
import {
  WorkspaceAccessReason,
  type CapabilityCheckInput,
  type CapabilityCheckResult,
  type CapabilityChecker,
} from "../capabilities";
import { getChatProvider } from "./registry";

export type DebugSettingsReader = () => DebugProviderSettings;

export function createRegistryCapabilityChecker(
  getDebugProviderSettings: DebugSettingsReader,
): CapabilityChecker {
  return {
    async checkCapabilities(input: CapabilityCheckInput): Promise<CapabilityCheckResult> {
      const provider = getChatProvider(input.provider);
      if (provider) {
        return provider.checkCapabilities(input);
      }

      if (input.provider === "debug") {
        return {
          status: "blocked",
          reason: WorkspaceAccessReason.ProviderUnsupported,
          capabilities: {
            canReadWorkspaceFiles: false,
            supportedModes: [],
          },
          message: "Debug provider is not registered.",
          recoveryHint: "Restart the app or check provider initialization.",
        };
      }

      if (input.provider === "glm") {
        return {
          status: "blocked",
          reason: WorkspaceAccessReason.MissingProviderConfig,
          capabilities: null,
          message: "GLM provider is not configured yet.",
          recoveryHint: "Configure GLM credentials in Settings when available.",
        };
      }

      return {
        status: "blocked",
        reason: WorkspaceAccessReason.ProviderUnsupported,
        capabilities: null,
        message: `${input.provider} provider is not integrated yet.`,
        recoveryHint: "Choose a supported provider or enable Debug in Developer Settings.",
      };
    },
  };
}
