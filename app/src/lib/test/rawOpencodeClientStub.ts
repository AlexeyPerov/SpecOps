import type { RawOpencodeClient } from "../ai/backends/workspaceAgentBackend";

/**
 * Builds a `RawOpencodeClient` stub with no-op defaults for every method.
 * Callers spread overrides over the defaults:
 *
 * ```ts
 * const client = createRawOpencodeClientStub({
 *   async listSessionChildren() { return [{ id: "child" }]; },
 * });
 * ```
 *
 * Kept in `lib/test/` (not colocated with the backend) because three separate
 * test files build their own client stubs and the `RawOpencodeClient` surface
 * grows with each milestone — centralizing the defaults keeps them from
 * drifting out of sync.
 */
export function createRawOpencodeClientStub(
  overrides: Partial<RawOpencodeClient> = {},
): RawOpencodeClient {
  return {
    async createSession() {
      return { id: "sess-1", title: "Session" };
    },
    async getSession() {
      return { id: "sess-1", title: "Session" };
    },
    async listSessions() {
      return [];
    },
    async deleteSession() {
      return null;
    },
    async sendPrompt() {
      return { sessionID: "sess-1" };
    },
    async replyPermission() {
      return null;
    },
    async replyQuestion() {
      return null;
    },
    async rejectQuestion() {
      return null;
    },
    async abortSession() {
      return null;
    },
    async *streamEvents() {
      // no events
    },
    async listMessages() {
      return [];
    },
    async updateSession() {
      return { id: "sess-1", title: "Session", time: { created: 1, updated: 2 } };
    },
    async forkSession() {
      return {
        id: "sess-fork",
        title: "Forked session",
        parentID: "sess-1",
        time: { created: 3, updated: 3 },
      };
    },
    async revertSession() {
      return { id: "sess-1", title: "Session", time: { created: 1, updated: 4 } };
    },
    async unrevertSession() {
      return { id: "sess-1", title: "Session", time: { created: 1, updated: 5 } };
    },
    async shareSession() {
      return {
        id: "sess-1",
        title: "Session",
        share: { url: "https://share.example/sess-1" },
        time: { created: 1, updated: 6 },
      };
    },
    async unshareSession() {
      return { id: "sess-1", title: "Session", time: { created: 1, updated: 7 } };
    },
    async summarizeSession() {
      return true;
    },
    async listSessionChildren() {
      return [];
    },
    async listModels() {
      return { data: [] };
    },
    async listProviders() {
      return { data: [] };
    },
    async listAgents() {
      return { data: [] };
    },
    async listCommands() {
      return { data: [] };
    },
    async findFiles() {
      return { data: [] };
    },
    // M4 — config / provider / mcp / app endpoints
    async getConfig() {
      return { data: {} };
    },
    async updateConfig() {
      return { data: {} };
    },
    async listProviderStatuses() {
      return { data: { all: [], connected: [] } };
    },
    async listProviderAuthMethods() {
      return { data: {} };
    },
    async setProviderAuth() {
      return { data: true };
    },
    async removeProviderAuth() {
      return { data: true };
    },
    async startProviderOAuth() {
      return { data: null };
    },
    async completeProviderOAuth() {
      return true;
    },
    async listMcpStatuses() {
      return { data: {} };
    },
    async addMcpServer() {
      return { data: {} };
    },
    async connectMcpServer() {
      return true;
    },
    async disconnectMcpServer() {
      return true;
    },
    async listSkills() {
      return { data: [] };
    },
    async listAgentDetails() {
      return { data: [] };
    },
    ...overrides,
  };
}
