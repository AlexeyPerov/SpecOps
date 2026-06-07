import type { ChatProviderId, ChatThreadSnapshot, ProviderModelCatalogs } from "../../domain/contracts";
import {
  getLocalInvalidModelMessage,
  getLocalInvalidModelRecovery,
  getProviderInvalidModelMessage,
  getProviderInvalidModelRecovery,
  getProviderRuntimeModelRejectionMessage,
} from "../chatErrorCopy";
import { ChatProviderError } from "./errors";
import { formatChatProviderLabel } from "./selection";
import { normalizeProviderModelCatalogs } from "./providerModelCatalog";
import {
  isModelInThreadCatalog,
  resolveThreadCatalogDefaultModelId,
  type ThreadModelCatalogContext,
} from "./threadModelCatalog";

export type { ThreadModelCatalogContext };

export type LocalModelValidationResult =
  | { ok: true; modelId: string }
  | { ok: false; message: string; recoveryHint: string };

/** Resolves the effective model for a thread from metadata or provider catalog default. */
export function resolveEffectiveThreadModelId(
  thread: ChatThreadSnapshot,
  catalogs: ProviderModelCatalogs,
  context?: ThreadModelCatalogContext,
): string {
  const normalizedCatalogs = normalizeProviderModelCatalogs(catalogs);
  const providerId = thread.metadata.provider;
  const catalogContext: ThreadModelCatalogContext = {
    providerSettings: context?.providerSettings,
    connectionId: context?.connectionId ?? thread.metadata.connectionId,
  };
  const selected = thread.metadata.selectedModelId?.trim();
  if (selected) {
    return selected;
  }
  return resolveThreadCatalogDefaultModelId(normalizedCatalogs, providerId, catalogContext);
}

/** Validates that a model id is present in the thread's resolved provider catalog. */
export function validateLocalModelSelection(
  catalogs: ProviderModelCatalogs,
  providerId: ChatProviderId,
  modelId: string,
  context?: ThreadModelCatalogContext,
): LocalModelValidationResult {
  const normalizedCatalogs = normalizeProviderModelCatalogs(catalogs);
  const trimmed = modelId.trim();
  if (!trimmed) {
    return {
      ok: false,
      message: getLocalInvalidModelMessage(trimmed, formatChatProviderLabel(providerId)),
      recoveryHint: getLocalInvalidModelRecovery(providerId),
    };
  }

  if (isModelInThreadCatalog(normalizedCatalogs, providerId, trimmed, context)) {
    return { ok: true, modelId: trimmed };
  }

  return {
    ok: false,
    message: getLocalInvalidModelMessage(trimmed, formatChatProviderLabel(providerId)),
    recoveryHint: getLocalInvalidModelRecovery(providerId),
  };
}

const MODEL_REJECTION_PATTERNS = [
  /\bmodel\b.+\b(not found|does not exist|unavailable|unknown|unsupported|invalid)\b/i,
  /\b(not found|does not exist|unavailable|unknown|unsupported|invalid)\b.+\bmodel\b/i,
  /\binvalid model\b/i,
  /\bmodel id\b.+\b(invalid|unknown|unsupported)\b/i,
];

export function isProviderModelRejectionMessage(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }
  return MODEL_REJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isProviderModelRejectionStatus(status: number): boolean {
  return status === 400 || status === 404 || status === 422;
}

export function shouldMapProviderModelRejection(status: number, message: string): boolean {
  return isProviderModelRejectionStatus(status) && isProviderModelRejectionMessage(message);
}

/** Maps provider/runtime model rejection to user-safe blocked copy. */
export function mapProviderModelRuntimeError(
  error: unknown,
  providerId: ChatProviderId,
  modelId: string,
): ChatProviderError {
  const providerLabel = formatChatProviderLabel(providerId);
  const userMessage = getProviderInvalidModelMessage(modelId.trim(), providerLabel);
  const recoveryHint = getProviderInvalidModelRecovery(providerId);

  if (error instanceof ChatProviderError) {
    if (isProviderModelRejectionMessage(error.message) || isProviderModelRejectionMessage(error.userMessage)) {
      return new ChatProviderError(error.message, `${userMessage} ${recoveryHint}`);
    }
    return error;
  }

  const detail = error instanceof Error ? error.message : String(error);
  if (isProviderModelRejectionMessage(detail)) {
    return new ChatProviderError(detail, `${userMessage} ${recoveryHint}`);
  }

  if (error instanceof Error) {
    return new ChatProviderError(error.message, error.message);
  }

  return new ChatProviderError(String(error), getProviderRuntimeModelRejectionMessage(providerLabel));
}
