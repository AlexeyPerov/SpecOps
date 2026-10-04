import {
  createOpencodeClient,
  type OpencodeClient,
} from "@opencode-ai/sdk/v2/client";
import {
  spawn,
  execFile,
  execFileSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import type { RuntimeProfile, RuntimeProfileStore } from "./profiles";
export const OPENCODE_VERSION = "1.17.4";
export function runtimeOwner(
  env: NodeJS.ProcessEnv = process.env,
): "host" | "legacy" {
  const value = env.SPECOPS_OPENCODE_OWNER ?? "host";
  if (value !== "host" && value !== "legacy")
    throw new Error("Invalid OpenCode runtime owner");
  return value;
}
export function resolveExecutable(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const override = env.SPECOPS_OPENCODE_EXECUTABLE;
  if (override !== undefined)
    return isAbsolute(override) && existsSync(override) ? override : null;
  for (const part of (env.PATH ?? "").split(
    process.platform === "win32" ? ";" : ":",
  )) {
    const path = join(
      part,
      process.platform === "win32" ? "opencode.exe" : "opencode",
    );
    if (existsSync(path)) return path;
  }
  return null;
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Cannot allocate runtime port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}
export class RuntimeConnection {
  client: OpencodeClient | null = null;
  child: ChildProcessWithoutNullStreams | null = null;
  generation = 0;
  onExit: (generation: number) => void = () => {};
  private lifecycle = 0;
  private starting: Promise<void> | null = null;
  private descendants = new Map<number, string>();
  private monitor?: ReturnType<typeof setInterval>;
  constructor(
    readonly profile: RuntimeProfile,
    readonly store: RuntimeProfileStore,
    readonly executable: string | null,
    private readonly ambient = process.env,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.client) return;
    const token = ++this.lifecycle;
    this.starting = this.launch(token)
      .catch(() => {
        if (token === this.lifecycle) this.close();
        throw new Error(
          "OpenCode connection failed. Verify executable, endpoint and profile configuration.",
        );
      })
      .finally(() => {
        if (token === this.lifecycle) this.starting = null;
      });
    return this.starting;
  }
  private async launch(token: number): Promise<void> {
    if (runtimeOwner(this.ambient) !== "host")
      throw new Error("Runtime is owned by legacy parity mode");
    const generation = ++this.generation;
    let baseUrl = this.profile.endpoint;
    let authorization: string | undefined;
    if (this.profile.ownership === "local") {
      if (!this.executable)
        throw new Error("Runtime executable is unavailable");
      const env = this.store.environment(this.profile.id, this.ambient);
      await new Promise<void>((resolve, reject) =>
        execFile(
          this.executable!,
          ["--version"],
          { env, timeout: 5000, maxBuffer: 4096 },
          (error, out) =>
            error || out.trim() !== OPENCODE_VERSION
              ? reject(new Error("Unsupported runtime version"))
              : resolve(),
        ),
      );
      const port = await freePort();
      if (token !== this.lifecycle)
        throw new Error("Runtime startup cancelled");
      const password = randomBytes(32).toString("hex");
      authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
      const child = spawn(
        this.executable!,
        ["serve", "--hostname", "127.0.0.1", "--port", String(port)],
        {
          cwd: this.store.home(this.profile.id),
          env: { ...env, OPENCODE_SERVER_PASSWORD: password },
          stdio: "pipe",
        },
      );
      this.child = child;
      child.stdin.on("error", () => {});
      child.stdout.on("data", () => {});
      child.stderr.on("data", () => {});
      const retire = () => {
        if (this.child !== child) return;
        this.cleanup(child.pid);
        this.child = null;
        this.client = null;
        this.lifecycle++;
        this.starting = null;
        this.onExit(generation);
      };
      child.once("error", retire);
      child.once("exit", retire);
      if (process.platform !== "win32") {
        this.monitor = setInterval(() => this.track(child.pid), 250);
        this.monitor.unref();
      }
      baseUrl = `http://127.0.0.1:${port}`;
    }
    const client = createOpencodeClient({
      baseUrl,
      throwOnError: true,
      ...(authorization ? { headers: { Authorization: authorization } } : {}),
      fetch: (input, init) => {
        const request = new Request(input, init);
        return this.fetcher(request, {
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(3000)]),
        });
      },
    });
    const deadline = Date.now() + 10000;
    while (token === this.lifecycle) {
      try {
        const result = await client.global.health();
        if (
          token !== this.lifecycle ||
          !result.data?.healthy ||
          result.data.version !== OPENCODE_VERSION
        )
          throw new Error("Incompatible runtime health");
        this.client = client;
        return;
      } catch {
        if (
          this.profile.ownership === "external" ||
          Date.now() >= deadline ||
          token !== this.lifecycle
        )
          throw new Error("Runtime health unavailable");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error("Runtime startup cancelled");
  }
  private rows() {
    return execFileSync("/bin/ps", ["-axo", "pid=,ppid=,lstart="], {
      encoding: "utf8",
      timeout: 1000,
      maxBuffer: 1024 * 1024,
    })
      .trim()
      .split("\n")
      .flatMap((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
        return match
          ? [
              {
                pid: Number(match[1]),
                parent: Number(match[2]),
                stamp: match[3]!,
              },
            ]
          : [];
      });
  }
  private track(parent?: number): void {
    if (!parent) return;
    try {
      const rows = this.rows();
      const parents = new Set([
        parent,
        ...rows
          .filter((row) => this.descendants.get(row.pid) === row.stamp)
          .map((row) => row.pid),
      ]);
      for (let depth = 0; depth < 64; depth++) {
        let changed = false;
        for (const row of rows)
          if (
            parents.has(row.parent) &&
            row.pid !== process.pid &&
            !parents.has(row.pid)
          ) {
            parents.add(row.pid);
            this.descendants.set(row.pid, row.stamp);
            changed = true;
          }
        if (!changed) break;
      }
    } catch {}
  }
  private cleanup(parent?: number): void {
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = undefined;
    this.track(parent);
    if (process.platform === "win32" && parent) {
      try {
        execFileSync("taskkill", ["/pid", String(parent), "/T", "/F"], {
          stdio: "ignore",
          timeout: 2000,
        });
      } catch {}
    } else
      try {
        for (const row of this.rows().reverse())
          if (this.descendants.get(row.pid) === row.stamp) {
            try {
              process.kill(row.pid, "SIGKILL");
            } catch {}
          }
      } catch {}
    this.descendants.clear();
  }
  close(): void {
    this.lifecycle++;
    this.starting = null;
    this.client = null;
    const child = this.child;
    this.child = null;
    if (child) {
      this.cleanup(child.pid);
      child.kill("SIGTERM");
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 750);
      timer.unref();
    }
    this.onExit(this.generation);
  }
}
