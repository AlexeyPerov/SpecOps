import type { AppProviderSettings, HttpConnectionSettings } from "../../domain/contracts";
import {
  WorkspaceAccessReason,
  type CapabilityCheckInput,
  type CapabilityCheckResult,
  type CapabilityChecker,
} from "../capabilities";
import {
  PROVIDER_MISSING_CONFIG_MESSAGE,
  PROVIDER_MISSING_CONFIG_RECOVERY,
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

export type AppProviderSettingsReader = () => AppProviderSettings;

export type HttpSettingsReader = (connectionId?: string) => {
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
  getProviderSettings: AppProviderSettingsReader,
  getHttpConnectionSettings?: HttpSettingsReader,
): CapabilityChecker {
  return {
    async checkCapabilities(input: CapabilityCheckInput): Promise<CapabilityCheckResult> {
      if (input.provider === "http") {
        const httpReader =
          getHttpConnectionSettings ??
          (() => {
            const settings = getProviderSettings();
            const fallback = settings.httpConnections?.[0] ?? settings.http;
            if (!fallback) {
              return {
                settings: { enabled: false, baseUrl: "" },
                apiKey: "",
              };
            }
            return { settings: fallback, apiKey: "" };
          });
        const { settings, apiKey } = httpReader(input.connectionId);
        if (!isHttpProviderConfigured(settings, apiKey)) {
          return missingHttpConfigResult();
        }

        const provider = getChatProvider(input.provider);
        if (provider) {
          return provider.checkCapabilities({
            ...input,
            connectionId: input.connectionId,
          });
        }

        return missingHttpConfigResult();
      }

      const provider = getChatProvider(input.provider);
      if (provider) {
        return provider.checkCapabilities(input);
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
