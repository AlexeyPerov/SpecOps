import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import type {
  Options,
  Query,
  SDKMessage,
  SessionMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeAssets } from "./runtime";
import { loadClaudeSdk } from "./runtime";
/** Own native child trees inside the supervisor process group. Never merge the SDK's ambient environment. */
export class ClaudeProcessOwner {
  private closed = false;
  private children = new Map<ChildProcess, string>();
  private descendants = new Map<number, string>();
  private monitor?: ReturnType<typeof setInterval>;
  private rows() {
    try {
      return execFileSync("/bin/ps", ["-axo", "pid=,ppid=,lstart="], {
        encoding: "utf8",
        timeout: 1000,
        maxBuffer: 1024 * 1024,
      })
        .trim()
        .split("\n")
        .slice(0, 20000)
        .flatMap((line) => {
          const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
          return m
            ? [{ pid: Number(m[1]), parent: Number(m[2]), stamp: m[3]! }]
            : [];
        });
    } catch {
      return [];
    }
  }
  private track() {
    const rows = this.rows();
    const parents = new Set(
      rows
        .filter(
          (row) =>
            this.descendants.get(row.pid) === row.stamp ||
            [...this.children].some(
              ([child, stamp]) => child.pid === row.pid && stamp === row.stamp,
            ),
        )
        .map((row) => row.pid),
    );
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
  }
  own(child: ChildProcess) {
    const stamp = this.rows().find((row) => row.pid === child.pid)?.stamp ?? "";
    this.children.set(child, stamp);
    if (child.pid && stamp) this.descendants.set(child.pid, stamp);
    if (process.platform !== "win32" && !this.monitor) {
      this.monitor = setInterval(() => this.track(), 250);
      this.monitor.unref();
    }
    child.once("exit", () => {
      this.track();
      this.children.delete(child);
    });
  }
  spawn(
    env: NodeJS.ProcessEnv,
  ): NonNullable<Options["spawnClaudeCodeProcess"]> {
    return (options) => {
      if (this.closed || options.signal.aborted)
        throw new Error("Native process initialization cancelled");
      const child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.own(child);
      child.stderr!.resume();
      const kill = () => void this.close();
      options.signal.addEventListener("abort", kill, { once: true });
      child.once("exit", () =>
        options.signal.removeEventListener("abort", kill),
      );
      return child as unknown as ReturnType<
        NonNullable<Options["spawnClaudeCodeProcess"]>
      >;
    };
  }
  async close(): Promise<void> {
    this.closed = true;
    this.track();
    clearInterval(this.monitor);
    this.monitor = undefined;
    const children = [...this.children.keys()];
    if (process.platform === "win32") {
      for (const child of children)
        if (child.pid)
          try {
            execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
              timeout: 1000,
              stdio: "ignore",
            });
          } catch {}
    } else
      for (const row of this.rows().reverse())
        if (this.descendants.get(row.pid) === row.stamp)
          try {
            process.kill(row.pid, "SIGKILL");
          } catch {}
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    this.descendants.clear();
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null)
              return resolve();
            const timer = setTimeout(resolve, 1500);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          }),
      ),
    );
  }
}
export interface ClaudeSessionDriver {
  query(input: {
    prompt: AsyncIterable<SDKUserMessage>;
    options: Options;
  }): Promise<Query>;
  history(
    id: string,
    directory: string,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<{ exists: boolean; messages: SessionMessage[] }>;
}
export function nativeSessionDriver(assets: ClaudeAssets): ClaudeSessionDriver {
  return {
    async query(input) {
      return (await loadClaudeSdk(assets)).query(input);
    },
    async history(id, directory, env, signal) {
      // The SDK resolves profile directories from process.env. Isolate the official
      // reader in a fresh process rather than switching the host's global account.
      const script = `import {pathToFileURL} from 'node:url'; const sdk=await import(pathToFileURL(process.argv[1]).href); const options={dir:process.argv[3]}; const info=await sdk.getSessionInfo(process.argv[2],options); if(info?.fileSize>8*1024*1024)throw new Error('Native history exceeds capacity'); const messages=info?await sdk.getSessionMessages(process.argv[2],{...options,limit:4097}):[]; process.stdout.write(JSON.stringify({exists:!!info,messages}));`;
      return new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--input-type=module", "-e", script, assets.sdk, id, directory],
          { env, stdio: ["ignore", "pipe", "ignore"] },
        );
        const onAbort = () => finish(new Error("Native history cancelled"));
        if (signal?.aborted) {
          child.kill("SIGKILL");
          reject(new Error("Native history cancelled"));
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        let output = "";
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          clearTimeout(timer);
          if (error) {
            child.kill("SIGKILL");
            reject(error);
          } else {
            try {
              const value = JSON.parse(output);
              if (
                typeof value.exists !== "boolean" ||
                !Array.isArray(value.messages) ||
                value.messages.length > 4096
              )
                throw new Error();
              resolve(value);
            } catch {
              reject(
                new Error("Native history exceeds capacity or is unavailable"),
              );
            }
          }
        };
        const timer = setTimeout(
          () => finish(new Error("Native history timed out")),
          10000,
        );
        child.stdout.on("data", (chunk) => {
          output += chunk;
          if (Buffer.byteLength(output) > 8 * 1024 * 1024)
            finish(new Error("Native history exceeds capacity"));
        });
        child.once("error", () =>
          finish(new Error("Native history unavailable")),
        );
        child.once("close", (code) =>
          finish(
            code === 0 ? undefined : new Error("Native history unavailable"),
          ),
        );
      });
    },
  };
}
export type ClaudeNativeMessage = SDKMessage;
