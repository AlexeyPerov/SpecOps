import type { DebugProviderSettings } from "../../domain/contracts";
import {
  WorkspaceAccessReason,
  type CapabilityCheckInput,
  type CapabilityCheckResult,
  type WorkspaceAccessStatus,
} from "../capabilities";
import {
  DEBUG_PROVIDER_DISABLED_MESSAGE,
  DEBUG_PROVIDER_DISABLED_RECOVERY,
} from "../chatErrorCopy";
import {
  getDebugProviderSendBlockHint,
  normalizeDebugProviderSettings,
} from "./debugProviderSettings";
import {
  appendDebugDiagnostics,
  buildDebugDiagnosticsAppendix,
  buildDebugResponseBody,
} from "./debugResponses";
import {
  deriveDebugTurnSimulation,
  sleep,
  splitIntoChunks,
} from "./debugSimulation";
import { ChatProviderError } from "./errors";
import type {
  ChatProvider,
  ProviderSendRequest,
  ProviderSendResponse,
  ProviderStreamChunk,
} from "./types";

export type DebugSettingsReader = () => DebugProviderSettings;

export function createDebugChatProvider(getSettings: DebugSettingsReader): ChatProvider {
  return new DebugChatProvider(getSettings);
}

class DebugChatProvider implements ChatProvider {
  readonly id = "debug" as const;

  constructor(private readonly getSettings: DebugSettingsReader) {}

  async checkCapabilities(input: CapabilityCheckInput): Promise<CapabilityCheckResult> {
    const settings = normalizeDebugProviderSettings(this.getSettings());
    if (!settings.enabled) {
      return {
        status: "blocked",
        reason: WorkspaceAccessReason.ProviderUnsupported,
        capabilities: {
          canReadWorkspaceFiles: false,
          supportedModes: [],
        },
        message: DEBUG_PROVIDER_DISABLED_MESSAGE,
        recoveryHint: DEBUG_PROVIDER_DISABLED_RECOVERY,
      };
    }

    return {
      status: "ready",
      reason: WorkspaceAccessReason.Unknown,
      capabilities: {
        canReadWorkspaceFiles: true,
        supportedModes: ["ask", "review"],
      },
      message: "Debug provider is ready for workspace chat.",
    };
  }

  async sendMessage(request: ProviderSendRequest): Promise<ProviderSendResponse> {
    const settings = normalizeDebugProviderSettings(this.getSettings());
    this.assertEnabled(settings);

    const turnKey = resolveTurnKey(request);
    const body = buildDebugResponseBody(request.payload.mode, request.payload);
    const simulation = deriveDebugTurnSimulation(settings, turnKey, body.length);
    const accessStatus = request.accessStatus ?? "unknown";

    if (settings.delayMsMin === 0 && settings.delayMsMax === 0) {
      if (simulation.shouldFail) {
        throw new ChatProviderError(settings.failureMessage, settings.failureMessage);
      }
      return {
        content: this.buildFinalContent(body, request, settings, simulation, accessStatus),
      };
    }

    await sleep(simulation.delayMs);
    if (simulation.shouldFail) {
      throw new ChatProviderError(settings.failureMessage, settings.failureMessage);
    }

    return {
      content: this.buildFinalContent(body, request, settings, simulation, accessStatus),
    };
  }

  async *streamMessage(request: ProviderSendRequest): AsyncIterable<ProviderStreamChunk> {
    const settings = normalizeDebugProviderSettings(this.getSettings());
    this.assertEnabled(settings);

    const turnKey = resolveTurnKey(request);
    const body = buildDebugResponseBody(request.payload.mode, request.payload);
    const simulation = deriveDebugTurnSimulation(settings, turnKey, body.length);
    const accessStatus = request.accessStatus ?? "unknown";
    const finalContent = this.buildFinalContent(body, request, settings, simulation, accessStatus);

    await sleep(simulation.delayMs);
    if (simulation.shouldFail) {
      throw new ChatProviderError(settings.failureMessage, settings.failureMessage);
    }

    for (const delta of splitIntoChunks(finalContent, simulation.chunkSizes)) {
      yield { delta };
    }
  }

  private assertEnabled(settings: DebugProviderSettings): void {
    if (!settings.enabled) {
      throw new ChatProviderError(
        DEBUG_PROVIDER_DISABLED_MESSAGE,
        getDebugProviderSendBlockHint(),
      );
    }
  }

  private buildFinalContent(
    body: string,
    request: ProviderSendRequest,
    settings: DebugProviderSettings,
    simulation: ReturnType<typeof deriveDebugTurnSimulation>,
    accessStatus: WorkspaceAccessStatus,
  ): string {
    const diagnostics = buildDebugDiagnosticsAppendix({
      payload: request.payload,
      modelId: request.modelId,
      accessStatus,
      simulation,
    });
    return appendDebugDiagnostics(body, diagnostics, settings.includeDiagnostics);
  }
}

function resolveTurnKey(request: ProviderSendRequest): string {
  return request.turnKey ?? `${request.modelId}:${request.payload.mode}:${request.payload.history.length}`;
}
