import type { CapabilityChecker } from "../../ai/capabilities";
import type { ChatStoreState } from "./types";
import { createThreadMessagesSlice } from "./threadMessages";
import { createThreadMetadataSlice } from "./threadMetadata";
import { createThreadProviderSelectionSlice } from "./threadProviderSelection";

type ChatStoreUpdate = (mutator: (state: ChatStoreState) => ChatStoreState) => void;

export function createThreadsSlice(deps: {
  update: ChatStoreUpdate;
  getSnapshot: () => ChatStoreState;
  getActiveChatScopeKey: () => string | null;
  getRuntimeState: (sessionId?: string) => { isGenerating: boolean };
  capabilityCheckerRef: { current: CapabilityChecker | null };
}) {
  const { update, getSnapshot, getActiveChatScopeKey, getRuntimeState, capabilityCheckerRef } = deps;

  const messagesSlice = createThreadMessagesSlice({ update, getSnapshot });
  const metadataSlice = createThreadMetadataSlice({ update, getSnapshot, getActiveChatScopeKey });
  const providerSelectionSlice = createThreadProviderSelectionSlice({
    update,
    getSnapshot,
    getActiveChatScopeKey,
    getRuntimeState,
    capabilityCheckerRef,
    threadMetadataApi: metadataSlice,
  });

  return {
    ...messagesSlice,
    ...metadataSlice,
    ...providerSelectionSlice,
  };
}
