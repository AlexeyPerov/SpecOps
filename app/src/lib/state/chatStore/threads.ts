import type { CapabilityChecker } from "../../ai/capabilities";
import type { ChatStoreState } from "./types";
import { createThreadMessagesSlice } from "./threadMessages";
import { createThreadMetadataSlice } from "./threadMetadata";

type ChatStoreUpdate = (mutator: (state: ChatStoreState) => ChatStoreState) => void;

export function createThreadsSlice(deps: {
  update: ChatStoreUpdate;
  getSnapshot: () => ChatStoreState;
  getActiveChatScopeKey: () => string | null;
  getRuntimeState: (sessionId?: string) => { isGenerating: boolean };
  capabilityCheckerRef: { current: CapabilityChecker | null };
}) {
  const { update, getSnapshot, getActiveChatScopeKey } = deps;

  const messagesSlice = createThreadMessagesSlice({ update, getSnapshot });
  const metadataSlice = createThreadMetadataSlice({ update, getSnapshot, getActiveChatScopeKey });

  return {
    ...messagesSlice,
    ...metadataSlice,
  };
}
