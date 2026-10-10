import { requireManagedCompatibility, managedEntry } from "../componentRuntime";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { ClaudeProcessOwner as NativeProcessOwner } from "../claude/session";
import type { CursorAssets } from "./runtime";
export interface CursorOperation {
  action: "create" | "history" | "send";
  store: string;
  cwd: string;
  key: string;
  modelId?: string;
  agentId?: string;
  prompt?: string;
  binding: Record<string, unknown>;
}
export type CursorFrame = Record<string, any>;
export interface CursorSessionDriver {
  operation(request: CursorOperation, signal: AbortSignal): AsyncIterable<CursorFrame>;
  stop?(): Promise<void>;
}
/** No SDK module/environment globals are shared between connection profiles. */
export function nativeCursorDriver(assets: CursorAssets, env: NodeJS.ProcessEnv, timeoutMs = 300000): CursorSessionDriver {
  let stopCurrent: (() => Promise<void>) | undefined;
  return { stop: () => stopCurrent?.() ?? Promise.resolve(), async *operation(request, signal) {
    if (signal.aborted) throw new Error("Native operation cancelled");
    requireManagedCompatibility("cursor", "1.0.35", "as09-cursor-1");
    const owner = new NativeProcessOwner();
    const child = spawn(process.execPath, [managedEntry("cursor") ?? join(dirname(assets.worker), "session-worker.mjs")], { env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    owner.own(child);
    let closed!: () => void;
    const exited = new Promise<void>((resolve) => { closed = resolve; });
    const decoder = new StringDecoder("utf8");
    let input = "", bytes = 0, queueBytes = 0, done = false, error: Error | undefined;
    const queue: CursorFrame[] = [];
    let wake: (() => void) | undefined;
    const stop = (message: string) => {
      error ??= new Error(message);
      done = true;
      wake?.();
      void owner.close();
    };
    let dispatched = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      if (done) return;
      if (!dispatched) { stop("Native operation cancelled"); return; }
      child.stdin.write('{"action":"cancel"}\n', () => {});
      grace ??= setTimeout(() => stop("Native operation cancelled"), 1500);
    };
    const timer = setTimeout(() => stop("Native operation timed out"), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      input += decoder.write(chunk);
      if (bytes > 16777216 || Buffer.byteLength(input) > 1048576) return stop("Native response exceeds capacity");
      let newline;
      while ((newline = input.indexOf("\n")) >= 0) {
        const line = input.slice(0, newline); input = input.slice(newline + 1);
        try {
          const frame = JSON.parse(line);
          if (!frame || typeof frame !== "object" || typeof frame.type !== "string") throw new Error();
          queueBytes += Buffer.byteLength(line);
          if (queue.length >= 4096 || queueBytes > 4194304) return stop("Native queue exceeds capacity");
          queue.push(frame); wake?.();
        } catch { return stop("Malformed native response"); }
      }
    });
    child.on("error", () => stop("Native worker unavailable"));
    child.stdin.on("error", () => stop("Native worker input unavailable"));
    child.on("close", (code) => {
      if (input.trim() || code !== 0) error ??= new Error("Native worker exited unexpectedly");
      done = true; wake?.(); closed();
    });
    stopCurrent = async () => { abort(); await exited; await owner.close(); };
    const serialized = JSON.stringify({ ...request, sdk: assets.sdk }) + "\n";
    try {
      if (Buffer.byteLength(serialized) > 1048576) throw new Error("Native input exceeds capacity");
      if (signal.aborted) abort();
      else { dispatched = true; child.stdin.write(serialized); }
      while (true) {
        if (queue.length) {
          const frame = queue.shift()!;
          queueBytes -= Buffer.byteLength(JSON.stringify(frame));
          yield frame;
        } else if (done) break;
        else await new Promise<void>((resolve) => { wake = resolve; });
      }
      if (error) throw error;
    } finally {
      clearTimeout(timer); clearTimeout(grace);
      signal.removeEventListener("abort", abort);
      child.stdin.destroy();
      await owner.close();
      stopCurrent = undefined;
    }
  } };
}
