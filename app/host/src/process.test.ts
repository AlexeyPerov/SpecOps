import { describe, expect, it, beforeAll } from "vitest";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PROTOCOL_VERSION, ProtocolErrorCode } from "./protocol";
import { buildOversizedLine, PROTOCOL_FIXTURES } from "./fixtures";

const hostDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = path.join(hostDir, "dist", "index.js");

beforeAll(() => {
  // Build a fresh bundle so the process suite runs against current source.
  spawnSync("node", ["scripts/build.mjs"], { cwd: hostDir, stdio: "pipe" });
}, 30_000);

interface ParsedMessage {
  id?: number | string;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string };
  params?: { event?: { type: string; seq: number }; nativeSessionId?: string };
}

class HostClient {
  readonly proc: ChildProcessWithoutNullStreams;
  private readonly stdoutLines: string[] = [];
  private readonly stderrLines: string[] = [];
  private stdoutCarry = "";
  private stderrCarry = "";
  private nextId = 10;
  private exited = false;
  private exitCode: number | null = null;
  private exitResolve: ((code: number | null) => void) | null = null;

  constructor() {
    this.proc = spawn("node", [distEntry]);
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => {
      this.stdoutCarry = this.consumeLines(chunk, this.stdoutCarry, this.stdoutLines);
    });
    this.proc.stderr.on("data", (chunk: string) => {
      this.stderrCarry = this.consumeLines(chunk, this.stderrCarry, this.stderrLines);
    });
    // Capture exit eagerly: the host may exit before a test calls waitForExit.
    this.proc.on("exit", (code) => {
      this.exited = true;
      this.exitCode = code;
      this.exitResolve?.(code);
    });
  }

  private consumeLines(chunk: string, carry: string, sink: string[]): string {
    let buffer = carry + chunk;
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim().length > 0) sink.push(line);
    }
    return buffer;
  }

  send(message: Record<string, unknown>): void {
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  sendRaw(line: string): void {
    this.proc.stdin.write(`${line}\n`);
  }

  request(method: string, params?: unknown): number {
    const id = this.nextId++;
    this.send({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
    return id;
  }

  get messages(): ParsedMessage[] {
    return this.stdoutLines.map((line) => JSON.parse(line) as ParsedMessage);
  }

  get stderrText(): string {
    return this.stderrLines.join("\n");
  }

  async waitFor(predicate: (message: ParsedMessage) => boolean, timeoutMs = 5_000): Promise<ParsedMessage> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = this.messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`timed out waiting for message; stderr:\n${this.stderrText}`);
  }

  responseFor(id: number): Promise<ParsedMessage> {
    return this.waitFor((message) => message.id === id && (message.result !== undefined || message.error !== undefined));
  }

  close(): void {
    this.proc.stdin.end();
  }

  async waitForExit(timeoutMs = 5_000): Promise<number | null> {
    if (this.exited) return this.exitCode;
    return new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      this.exitResolve = (code) => {
        clearTimeout(timer);
        resolve(code);
      };
    });
  }
}

function initialize(client: HostClient, protocolVersion: number = PROTOCOL_VERSION): number {
  return client.request("initialize", { protocolVersion, client: { name: "process-suite" } });
}

describe("agent host over real stdio", () => {
  it("runs the full fake lifecycle and exits cleanly on shutdown", async () => {
    const client = new HostClient();
    try {
      const initId = initialize(client);
      const init = await client.responseFor(initId);
      const result = init.result as { protocolVersion: number; server: { runtimes: { id: string }[] } };
      expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(result.server.runtimes.map((r) => r.id)).toContain("fake");

      const discoverId = client.request("discover");
      const discover = await client.responseFor(discoverId);
      expect((discover.result as { runtimes: unknown[] }).runtimes.length).toBeGreaterThan(0);

      const createId = client.request("session.create", { runtimeId: "fake", workspaceRootPath: "/ws" });
      const created = await client.responseFor(createId);
      const nativeSessionId = (created.result as { nativeSessionId: string }).nativeSessionId;

      const turnId = client.request("turn.send", {
        turnId: "sos-turn-1",
        native: { runtimeId: "fake", nativeSessionId },
        workspaceRootPath: "/ws",
        prompt: "ping",
      });
      await client.responseFor(turnId); // ack
      const terminal = await client.waitFor(
        (message) => message.method === "session.event" && /turn\.(finished|failed|cancelled)/.test(message.params?.event?.type ?? ""),
      );
      expect(terminal.params?.event?.type).toBe("turn.finished");

      const healthId = client.request("health", {});
      await client.responseFor(healthId);

      const shutdownId = client.request("shutdown");
      await client.responseFor(shutdownId);

      const code = await client.waitForExit();
      expect(code).toBe(0);
    } finally {
      client.close();
    }
  });

  it("rejects an incompatible protocol version and exits", async () => {
    const client = new HostClient();
    try {
      const initId = initialize(client, 999);
      const init = await client.responseFor(initId);
      expect(init.error?.code).toBe(ProtocolErrorCode.PROTOCOL_VERSION_MISMATCH);
      const code = await client.waitForExit();
      expect(code).toBe(0);
    } finally {
      client.close();
    }
  });

  it("survives malformed JSON lines and keeps serving", async () => {
    const client = new HostClient();
    try {
      const malformed = PROTOCOL_FIXTURES.find((f) => f.name === "malformed-broken-json")!;
      client.sendRaw(malformed.line);
      const initId = initialize(client);
      const init = await client.responseFor(initId);
      expect(init.result).toBeDefined();
    } finally {
      client.close();
    }
  });

  it("survives oversized lines without crashing", async () => {
    const client = new HostClient();
    try {
      client.sendRaw(buildOversizedLine());
      const initId = initialize(client);
      const init = await client.responseFor(initId);
      expect(init.result).toBeDefined();
    } finally {
      client.close();
    }
  });

  it("responds METHOD_NOT_FOUND for unknown methods", async () => {
    const client = new HostClient();
    try {
      const initId = initialize(client);
      await client.responseFor(initId);
      const unknownId = client.request("does.not.exist");
      const response = await client.responseFor(unknownId);
      expect(response.error?.code).toBe(ProtocolErrorCode.METHOD_NOT_FOUND);
    } finally {
      client.close();
    }
  });

  it("forwards turn.cancelled when a long-running turn is cancelled (timeout model)", async () => {
    const client = new HostClient();
    try {
      await client.responseFor(initialize(client));
      const created = await client.responseFor(client.request("session.create", { runtimeId: "fake", workspaceRootPath: "/ws" }));
      const nativeSessionId = (created.result as { nativeSessionId: string }).nativeSessionId;

      client.request("turn.send", {
        turnId: "sos-turn-1",
        native: { runtimeId: "fake", nativeSessionId },
        workspaceRootPath: "/ws",
        prompt: "long-running",
      });
      client.request("turn.cancel", { native: { runtimeId: "fake", nativeSessionId } });

      const terminal = await client.waitFor(
        (message) => message.method === "session.event" && message.params?.event?.type === "turn.cancelled",
      );
      expect(terminal.params?.event?.type).toBe("turn.cancelled");
    } finally {
      client.close();
    }
  });
});
