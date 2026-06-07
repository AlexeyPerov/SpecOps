import type { ChatModeId, ChatProviderId, DebugProviderSettings } from "../../domain/contracts";
import {
  WorkspaceAccessReason,
  type CapabilityCheckInput,
  type CapabilityCheckResult,
  type WorkspaceAccessStatus,
} from "../capabilities";
import {
  getDebugProviderSendBlockHint,
  getDebugProviderSendBlockRecovery,
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
import {
  logChatProviderPayload,
  logChatProviderResponseBody,
} from "../chatDiagnostics";
import type {
  ChatProvider,
  ProviderSendRequest,
  ProviderSendResponse,
  ProviderStreamChunk,
} from "./types";

export type DebugSettingsReader = () => DebugProviderSettings;

export interface DebugChatProviderOptions {
  id: Extract<ChatProviderId, "debug-chat" | "debug-workspace">;
  getSettings: DebugSettingsReader;
  supportedModes: readonly ChatModeId[];
  canReadWorkspaceFiles: boolean;
  readyMessage: string;
}

export function createDebugChatProvider(options: DebugChatProviderOptions): ChatProvider {
  return new DebugChatProvider(options);
}

class DebugChatProvider implements ChatProvider {
  readonly id: Extract<ChatProviderId, "debug-chat" | "debug-workspace">;

  constructor(private readonly options: DebugChatProviderOptions) {
    this.id = options.id;
  }

  private getSettings(): DebugProviderSettings {
    return normalizeDebugProviderSettings(this.options.getSettings());
  }

  async checkCapabilities(input: CapabilityCheckInput): Promise<CapabilityCheckResult> {
    const settings = this.getSettings();
    if (!settings.enabled) {
      return {
        status: "blocked",
        reason: WorkspaceAccessReason.ProviderUnsupported,
        capabilities: {
          canReadWorkspaceFiles: false,
          supportedModes: [],
        },
        message: getDebugProviderSendBlockHint(this.id),
        recoveryHint: getDebugProviderSendBlockRecovery(this.id),
      };
    }

    return {
      status: "ready",
      reason: WorkspaceAccessReason.Unknown,
      capabilities: {
        canReadWorkspaceFiles: this.options.canReadWorkspaceFiles,
        supportedModes: [...this.options.supportedModes],
      },
      message: this.options.readyMessage,
    };
  }

  async sendMessage(request: ProviderSendRequest): Promise<ProviderSendResponse> {
    const settings = this.getSettings();
    this.assertEnabled(settings);

    const turnKey = resolveTurnKey(request);
    logChatProviderPayload({
      turnId: turnKey,
      providerId: this.id,
      connectionId: request.connectionId,
      modelId: request.modelId,
      payload: request.payload,
    });
    const body = buildDebugResponseBody(request.payload.mode, request.payload);
    const simulation = deriveDebugTurnSimulation(settings, turnKey, body.length);
    const accessStatus = request.accessStatus ?? "unknown";

    if (settings.delayMsMin === 0 && settings.delayMsMax === 0) {
      if (simulation.shouldFail) {
        throw new ChatProviderError(settings.failureMessage, settings.failureMessage);
      }
      const content = this.buildFinalContent(body, request, settings, simulation, accessStatus);
      this.logResponse(request, turnKey, false, content);
      return { content };
    }

    await sleep(simulation.delayMs);
    if (simulation.shouldFail) {
      throw new ChatProviderError(settings.failureMessage, settings.failureMessage);
    }

    const content = this.buildFinalContent(body, request, settings, simulation, accessStatus);
    this.logResponse(request, turnKey, false, content);
    return { content };
  }

  async *streamMessage(request: ProviderSendRequest): AsyncIterable<ProviderStreamChunk> {
    const settings = this.getSettings();
    this.assertEnabled(settings);

    const turnKey = resolveTurnKey(request);
    logChatProviderPayload({
      turnId: turnKey,
      providerId: this.id,
      connectionId: request.connectionId,
      modelId: request.modelId,
      payload: request.payload,
    });
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
    this.logResponse(request, turnKey, true, finalContent);
  }

  private logResponse(
    request: ProviderSendRequest,
    turnKey: string,
    stream: boolean,
    body: string,
  ): void {
    logChatProviderResponseBody({
      turnId: turnKey,
      providerId: this.id,
      connectionId: request.connectionId,
      modelId: request.modelId,
      stream,
      body,
    });
  }

  private assertEnabled(settings: DebugProviderSettings): void {
    if (!settings.enabled) {
      throw new ChatProviderError(
        getDebugProviderSendBlockHint(this.id),
        getDebugProviderSendBlockHint(this.id),
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
