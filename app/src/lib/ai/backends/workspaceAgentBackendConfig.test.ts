import { describe, expect, it } from "vitest";
import {
  WorkspaceAgentBackendError,
  createWorkspaceAgentBackend,
} from "./workspaceAgentBackend";
import { createRawOpencodeClientStub } from "../../test/rawOpencodeClientStub";

/**
 * M4 — configuration-management backend methods. Covers config round-trip,
 * provider auth flow, MCP add/connect lifecycle, agent create/edit/delete, and
 * permission rule serialization as exercised through the public backend.
 */
describe("workspaceAgentBackend — M4 config management", () => {
  function createBackend(clientOverrides: Parameters<typeof createRawOpencodeClientStub>[0] = {}) {
    return createWorkspaceAgentBackend("opencode", {
      resolveRuntimeConfig: async () => ({ mode: "url", baseUrl: "http://opencode.local", sidecarPort: 4096 }),
      resolveServerPassword: async () => "",
      createOpencodeClient: () => createRawOpencodeClientStub(clientOverrides),
    });
  }

  describe("getConfig / updateConfig", () => {
    it("getConfig unwraps the .data payload into a document", async () => {
      const backend = createBackend({
        async getConfig() {
          return { data: { model: "anthropic/x", username: "alice" } };
        },
      });
      const doc = await backend.getConfig({ workspaceRootPath: "/repo" });
      expect(doc).toEqual({ model: "anthropic/x", username: "alice" });
    });

    it("getConfig returns {} for a non-object payload", async () => {
      const backend = createBackend({
        async getConfig() {
          return { data: "not an object" };
        },
      });
      expect(await backend.getConfig({ workspaceRootPath: "/repo" })).toEqual({});
    });

    it("updateConfig forwards the document and returns the mapped result", async () => {
      let received: Record<string, unknown> | undefined;
      const backend = createBackend({
        async updateConfig(config) {
          received = config;
          return { data: { ...config, model: "anthropic/x" } };
        },
      });
      const result = await backend.updateConfig({
        workspaceRootPath: "/repo",
        config: { username: "bob" },
      });
      expect(received).toEqual({ username: "bob" });
      expect(result).toEqual({ username: "bob", model: "anthropic/x" });
    });

    it("config round-trips through the backend (form → updateConfig → getConfig)", async () => {
      let stored: Record<string, unknown> = {};
      const backend = createBackend({
        async getConfig() {
          return { data: stored };
        },
        async updateConfig(config) {
          stored = { ...config };
          return { data: stored };
        },
      });
      const before = await backend.getConfig({ workspaceRootPath: "/repo" });
      expect(before).toEqual({});
      await backend.updateConfig({
        workspaceRootPath: "/repo",
        config: { model: "anthropic/x", share: "manual" },
      });
      const after = await backend.getConfig({ workspaceRootPath: "/repo" });
      expect(after).toEqual({ model: "anthropic/x", share: "manual" });
    });
  });

  describe("listProviderStatuses", () => {
    it("maps provider.list into status entries with model counts", async () => {
      const backend = createBackend({
        async listProviderStatuses() {
          return {
            data: {
              all: [
                { id: "anthropic", name: "Anthropic", source: "config", models: { a: {}, b: {} } },
                { id: "openai", name: "OpenAI", source: "env", models: {} },
              ],
              connected: ["anthropic"],
            },
          };
        },
      });
      const providers = await backend.listProviderStatuses({ workspaceRootPath: "/repo" });
      expect(providers).toEqual([
        { id: "anthropic", name: "Anthropic", connected: true, modelCount: 2, source: "config" },
        { id: "openai", name: "OpenAI", connected: false, modelCount: 0, source: "env" },
      ]);
    });

    it("returns [] for a malformed payload", async () => {
      const backend = createBackend({
        async listProviderStatuses() {
          return "garbage";
        },
      });
      expect(await backend.listProviderStatuses({ workspaceRootPath: "/repo" })).toEqual([]);
    });
  });

  describe("provider auth", () => {
    it("setProviderApiKey forwards to auth.set and returns true", async () => {
      let received: { providerId?: string; apiKey?: string } | undefined;
      const backend = createBackend({
        async setProviderAuth(providerId, apiKey) {
          received = { providerId, apiKey };
          return { data: true };
        },
      });
      const ok = await backend.setProviderApiKey({
        workspaceRootPath: "/repo",
        providerId: "anthropic",
        apiKey: "sk-test",
      });
      expect(ok).toBe(true);
      expect(received).toEqual({ providerId: "anthropic", apiKey: "sk-test" });
    });

    it("setProviderApiKey returns false on authFailure", async () => {
      const backend = createBackend({
        async setProviderAuth() {
          throw new WorkspaceAgentBackendError({ code: "authFailure", message: "bad key" });
        },
      });
      const ok = await backend.setProviderApiKey({
        workspaceRootPath: "/repo",
        providerId: "anthropic",
        apiKey: "x",
      });
      expect(ok).toBe(false);
    });

    it("removeProviderAuth forwards provider id and returns true", async () => {
      let receivedId: string | undefined;
      const backend = createBackend({
        async removeProviderAuth(providerId) {
          receivedId = providerId;
          return { data: true };
        },
      });
      const ok = await backend.removeProviderAuth({
        workspaceRootPath: "/repo",
        providerId: "openai",
      });
      expect(ok).toBe(true);
      expect(receivedId).toBe("openai");
    });

    it("startProviderOAuth returns the authorization URL", async () => {
      const backend = createBackend({
        async startProviderOAuth() {
          return { data: "https://auth.example/authorize" };
        },
      });
      const url = await backend.startProviderOAuth({
        workspaceRootPath: "/repo",
        providerId: "github",
      });
      expect(url).toBe("https://auth.example/authorize");
    });

    it("startProviderOAuth tolerates a url field on an object payload", async () => {
      const backend = createBackend({
        async startProviderOAuth() {
          return { data: { url: "https://auth.example/o" } };
        },
      });
      const url = await backend.startProviderOAuth({
        workspaceRootPath: "/repo",
        providerId: "github",
      });
      expect(url).toBe("https://auth.example/o");
    });

    it("completeProviderOAuth returns true on success", async () => {
      let received: { providerId?: string; code?: string } | undefined;
      const backend = createBackend({
        async completeProviderOAuth(providerId, code) {
          received = { providerId, code };
          return true;
        },
      });
      const ok = await backend.completeProviderOAuth({
        workspaceRootPath: "/repo",
        providerId: "github",
        code: "abc",
      });
      expect(ok).toBe(true);
      expect(received).toEqual({ providerId: "github", code: "abc" });
    });
  });

  describe("MCP lifecycle", () => {
    it("listMcpStatuses maps the status map into entries", async () => {
      const backend = createBackend({
        async listMcpStatuses() {
          return {
            data: {
              filesystem: { status: "connected" },
              broken: { status: "failed", error: "boom" },
              off: { status: "disabled" },
              auth: { status: "needs_auth" },
            },
          };
        },
      });
      const statuses = await backend.listMcpStatuses({ workspaceRootPath: "/repo" });
      const byName = Object.fromEntries(statuses.map((s) => [s.name, s]));
      expect(byName.filesystem).toEqual({
        name: "filesystem",
        status: "connected",
        enabled: true,
      });
      expect(byName.broken).toEqual({
        name: "broken",
        status: "failed",
        error: "boom",
        enabled: true,
      });
      expect(byName.off.enabled).toBe(false);
      expect(byName.auth.status).toBe("needs_auth");
    });

    it("addMcpServer forwards name + config and maps the response", async () => {
      let received: { name?: string; config?: unknown } | undefined;
      const backend = createBackend({
        async addMcpServer(name, config) {
          received = { name, config };
          return { data: { newone: { status: "disabled" } } };
        },
      });
      const statuses = await backend.addMcpServer({
        workspaceRootPath: "/repo",
        name: "my-mcp",
        config: { type: "local", command: ["npx", "server"] },
      });
      expect(received).toEqual({ name: "my-mcp", config: { type: "local", command: ["npx", "server"] } });
      expect(statuses).toHaveLength(1);
      expect(statuses[0]?.name).toBe("newone");
    });

    it("connectMcpServer returns true and forwards the name", async () => {
      let received: string | undefined;
      const backend = createBackend({
        async connectMcpServer(name) {
          received = name;
          return true;
        },
      });
      const ok = await backend.connectMcpServer({ workspaceRootPath: "/repo", name: "mcp-a" });
      expect(ok).toBe(true);
      expect(received).toBe("mcp-a");
    });

    it("connectMcpServer returns false on notFound", async () => {
      const backend = createBackend({
        async connectMcpServer() {
          throw new WorkspaceAgentBackendError({ code: "notFound", message: "no" });
        },
      });
      const ok = await backend.connectMcpServer({ workspaceRootPath: "/repo", name: "missing" });
      expect(ok).toBe(false);
    });

    it("disconnectMcpServer returns true", async () => {
      const backend = createBackend({
        async disconnectMcpServer() {
          return true;
        },
      });
      const ok = await backend.disconnectMcpServer({ workspaceRootPath: "/repo", name: "x" });
      expect(ok).toBe(true);
    });
  });

  describe("listSkills + listAgentDetails", () => {
    it("listSkills maps skill entries", async () => {
      const backend = createBackend({
        async listSkills() {
          return {
            data: [
              { name: "docx", location: "/skills/docx", description: "Word docs" },
              { name: "empty" },
            ],
          };
        },
      });
      const skills = await backend.listSkills({ workspaceRootPath: "/repo" });
      expect(skills).toEqual([
        { name: "docx", location: "/skills/docx", description: "Word docs" },
      ]);
    });

    it("listSkills degrades to [] on transport errors", async () => {
      const backend = createBackend({
        async listSkills() {
          throw new WorkspaceAgentBackendError({ code: "serverUnavailable", message: "down" });
        },
      });
      expect(await backend.listSkills({ workspaceRootPath: "/repo" })).toEqual([]);
    });

    it("listAgentDetails maps the rich Agent shape", async () => {
      const backend = createBackend({
        async listAgentDetails() {
          return {
            data: [
              {
                name: "build",
                mode: "primary",
                native: true,
                description: "main agent",
                permission: [{ permission: "bash", pattern: "*", action: "allow" }],
                model: { modelID: "claude", providerID: "anthropic" },
                steps: 50,
              },
              { name: "custom", mode: "subagent" },
            ],
          };
        },
      });
      const agents = await backend.listAgentDetails({ workspaceRootPath: "/repo" });
      expect(agents).toHaveLength(2);
      expect(agents[0]).toMatchObject({
        name: "build",
        mode: "primary",
        builtin: true,
        description: "main agent",
        permissionRuleCount: 1,
        steps: 50,
        model: { modelId: "claude", providerId: "anthropic" },
      });
      expect(agents[1]).toMatchObject({ name: "custom", mode: "subagent", builtin: false });
    });

    it("listAgentDetails returns [] for a non-array payload", async () => {
      const backend = createBackend({
        async listAgentDetails() {
          return { data: "nope" };
        },
      });
      expect(await backend.listAgentDetails({ workspaceRootPath: "/repo" })).toEqual([]);
    });
  });
});
