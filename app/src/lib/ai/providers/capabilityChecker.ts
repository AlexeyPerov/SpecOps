import type { DebugProviderSettings, GlmProviderSettings } from "../../domain/contracts";
import {
  WorkspaceAccessReason,
  type CapabilityCheckInput,
  type CapabilityCheckResult,
  type CapabilityChecker,
} from "../capabilities";
import {
  getGlmProviderMissingConfigMessage,
  getGlmProviderSetupHint,
  isGlmProviderConfigured,
} from "./glmProviderSettings";
import { getChatProvider } from "./registry";

export type DebugSettingsReader = () => DebugProviderSettings;

export type GlmSettingsReader = () => {
  settings: GlmProviderSettings;
  apiKey: string;
};

function missingGlmConfigResult(): CapabilityCheckResult {
  return {
    status: "blocked",
    reason: WorkspaceAccessReason.MissingProviderConfig,
    capabilities: null,
    message: getGlmProviderMissingConfigMessage(),
    recoveryHint: getGlmProviderSetupHint(),
  };
}

export function createRegistryCapabilityChecker(
  getDebugProviderSettings: DebugSettingsReader,
  getGlmProviderSettings: GlmSettingsReader,
): CapabilityChecker {
  return {
    async checkCapabilities(input: CapabilityCheckInput): Promise<CapabilityCheckResult> {
      if (input.provider === "glm") {
        const { settings, apiKey } = getGlmProviderSettings();
        if (!isGlmProviderConfigured(settings, apiKey)) {
          return missingGlmConfigResult();
        }

        const provider = getChatProvider(input.provider);
        if (provider) {
          return provider.checkCapabilities(input);
        }

        return missingGlmConfigResult();
      }

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
