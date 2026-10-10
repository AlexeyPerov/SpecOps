import { managedEntry } from "../componentRuntime";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync, lstatSync } from "node:fs";
import { execFile } from "node:child_process";
import type { Options, Query } from "@anthropic-ai/claude-agent-sdk";
export const CLAUDE_SDK_VERSION = "0.3.289";
export const CLAUDE_NATIVE_VERSION = "2.1.289";
export class ClaudeRuntimeError extends Error {
  constructor(readonly state: "missing-runtime" | "incompatible-runtime") {
    super(
      state === "missing-runtime"
        ? "Claude assets are missing. Reinstall the app with the pinned native SDK assets."
        : "Claude assets are incompatible. Reinstall the supported app build.",
    );
  }
}
export interface ClaudeAssets {
  sdk: string;
  executable: string;
  sdkVersion: string;
  nativeVersion: string;
}
export function resolveClaudeAssets(): ClaudeAssets {
  const sdk = managedEntry("claude");
  if (sdk) return { sdk, executable: managedEntry("claude", "native")!, sdkVersion: CLAUDE_SDK_VERSION, nativeVersion: CLAUDE_NATIVE_VERSION };
  try {
    const base = dirname(fileURLToPath(import.meta.url));
    const packaged = join(base, "claude");
    if (existsSync(join(packaged, "assets.json"))) {
      if (lstatSync(join(packaged, "assets.json")).size > 65536)
        throw new ClaudeRuntimeError("incompatible-runtime");
      const manifest = JSON.parse(
        readFileSync(join(packaged, "assets.json"), "utf8"),
      );
      if (
        manifest.sdkVersion !== CLAUDE_SDK_VERSION ||
        manifest.nativeVersion !== CLAUDE_NATIVE_VERSION ||
        manifest.platform !== process.platform ||
        manifest.arch !== process.arch
      )
        throw new ClaudeRuntimeError("incompatible-runtime");
      if (!manifest.files || typeof manifest.files !== "object")
        throw new ClaudeRuntimeError("incompatible-runtime");
      const entries = Object.entries(manifest.files);
      if (
        entries.length < 3 ||
        entries.length > 100 ||
        entries.some(
          ([name, hash]) =>
            (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(name) &&
              name !== "claude") ||
            typeof hash !== "string" ||
            !/^[a-f0-9]{64}$/.test(hash),
        )
      )
        throw new ClaudeRuntimeError("incompatible-runtime");
      if (
        !manifest.files["sdk.mjs"] ||
        !manifest.files[process.platform === "win32" ? "claude.exe" : "claude"]
      )
        throw new ClaudeRuntimeError("incompatible-runtime");
      for (const [name] of entries) {
        if (!existsSync(join(packaged, name)))
          throw new ClaudeRuntimeError("missing-runtime");
        if (
          createHash("sha256")
            .update(readFileSync(join(packaged, name)))
            .digest("hex") !== manifest.files[name]
        )
          throw new ClaudeRuntimeError("incompatible-runtime");
      }
      return {
        sdk: join(packaged, "sdk.mjs"),
        executable: join(
          packaged,
          process.platform === "win32" ? "claude.exe" : "claude",
        ),
        sdkVersion: manifest.sdkVersion,
        nativeVersion: manifest.nativeVersion,
      };
    }
    if (!base.endsWith(join("src", "claude")))
      throw new ClaudeRuntimeError("missing-runtime");
    const require = createRequire(import.meta.url);
    const sdk = require.resolve("@anthropic-ai/claude-agent-sdk");
    const metadata = JSON.parse(
      readFileSync(join(dirname(sdk), "package.json"), "utf8"),
    );
    const executable = require.resolve(
      `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${process.platform === "win32" ? "claude.exe" : "claude"}`,
    );
    if (
      metadata.version !== CLAUDE_SDK_VERSION ||
      metadata.claudeCodeVersion !== CLAUDE_NATIVE_VERSION
    )
      throw new ClaudeRuntimeError("incompatible-runtime");
    return {
      sdk,
      executable,
      sdkVersion: metadata.version,
      nativeVersion: metadata.claudeCodeVersion,
    };
  } catch (error) {
    if (error instanceof ClaudeRuntimeError) throw error;
    throw new ClaudeRuntimeError("missing-runtime");
  }
}
export async function verifyClaudeAssets(
  assets: ClaudeAssets,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<void> {
  if (
    assets.sdkVersion !== CLAUDE_SDK_VERSION ||
    assets.nativeVersion !== CLAUDE_NATIVE_VERSION
  )
    throw new ClaudeRuntimeError("incompatible-runtime");
  await new Promise<void>((resolve, reject) =>
    execFile(
      assets.executable,
      ["--version"],
      { env, signal, timeout: 10000, maxBuffer: 4096 },
      (err, stdout) => {
        if (err) reject(new ClaudeRuntimeError("missing-runtime"));
        else if (!stdout.startsWith(CLAUDE_NATIVE_VERSION + " "))
          reject(new ClaudeRuntimeError("incompatible-runtime"));
        else resolve();
      },
    ),
  );
}
export async function loadClaudeSdk(assets: ClaudeAssets): Promise<{
  query: (params: {
    prompt: string | AsyncIterable<any>;
    options: Options;
  }) => Query;
}> {
  try {
    const sdk = await import(/* @vite-ignore */ pathToFileURL(assets.sdk).href);
    if (typeof sdk.query !== "function") throw new Error();
    return sdk;
  } catch {
    throw new ClaudeRuntimeError("incompatible-runtime");
  }
}
/** Native initialization only: no prompt, tools, project settings or account fallback. */
export async function probeClaudeSdk(
  assets: ClaudeAssets,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<readonly { value: string; displayName: string }[]> {
  await verifyClaudeAssets(assets, env, signal);
  const sdk = await loadClaudeSdk(assets);
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) abort.abort();
  async function* input() {
    if (abort.signal.aborted) return;
    await new Promise<void>((resolve) =>
      abort.signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  }
  const q = sdk.query({
    prompt: input(),
    options: {
      env,
      cwd: env.HOME,
      pathToClaudeCodeExecutable: assets.executable,
      settingSources: [],
      tools: [],
      abortController: abort,
      persistSession: false,
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      q.supportedModels(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Native initialization timed out")),
          10000,
        );
      }),
    ]);
  } catch {
    throw new Error(
      "Claude native initialization failed. Reconnect the selected profile.",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    abort.abort();
    q.close();
  }
}
