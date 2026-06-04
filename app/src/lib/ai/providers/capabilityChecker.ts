import type { DebugProviderSettings, HttpConnectionSettings } from "../../domain/contracts";
import {
  WorkspaceAccessReason,
  type CapabilityCheckInput,
  type CapabilityCheckResult,
  type CapabilityChecker,
} from "../capabilities";
import {
  PROVIDER_MISSING_CONFIG_MESSAGE,
  PROVIDER_MISSING_CONFIG_RECOVERY,
  PROVIDER_NOT_REGISTERED_MESSAGE,
  PROVIDER_NOT_REGISTERED_RECOVERY,
  getUnknownProviderMessage,
  getUnknownProviderRecovery,
} from "../chatErrorCopy";
import { isHttpProviderConfigured } from "./httpConnectionSettings";
import { getChatProvider } from "./registry";

export {
  resolveEffectiveThreadModelId,
  validateLocalModelSelection,
  type LocalModelValidationResult,
} from "./modelValidation";

export type DebugSettingsReader = () => DebugProviderSettings;

export type HttpSettingsReader = () => {
  settings: HttpConnectionSettings;
  apiKey: string;
};

function missingHttpConfigResult(): CapabilityCheckResult {
  return {
    status: "blocked",
    reason: WorkspaceAccessReason.MissingProviderConfig,
    capabilities: null,
    message: PROVIDER_MISSING_CONFIG_MESSAGE,
    recoveryHint: PROVIDER_MISSING_CONFIG_RECOVERY,
  };
}

export function createRegistryCapabilityChecker(
  getDebugProviderSettings: DebugSettingsReader,
  getHttpConnectionSettings: HttpSettingsReader,
): CapabilityChecker {
  return {
    async checkCapabilities(input: CapabilityCheckInput): Promise<CapabilityCheckResult> {
      if (input.provider === "http") {
        const { settings, apiKey } = getHttpConnectionSettings();
        if (!isHttpProviderConfigured(settings, apiKey)) {
          return missingHttpConfigResult();
        }

        const provider = getChatProvider(input.provider);
        if (provider) {
          return provider.checkCapabilities(input);
        }

        return missingHttpConfigResult();
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
          message: PROVIDER_NOT_REGISTERED_MESSAGE,
          recoveryHint: PROVIDER_NOT_REGISTERED_RECOVERY,
        };
      }

      return {
        status: "blocked",
        reason: WorkspaceAccessReason.ProviderUnsupported,
        capabilities: null,
        message: getUnknownProviderMessage(input.provider),
        recoveryHint: getUnknownProviderRecovery(),
      };
    },
  };
}
