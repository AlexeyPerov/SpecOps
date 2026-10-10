import { managedEntry, managedRoot } from "../componentRuntime";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, lstatSync } from "node:fs";
import { spawn } from "node:child_process";
import { ClaudeProcessOwner as NativeProcessOwner } from "../claude/session";
export const CURSOR_SDK_VERSION = "1.0.35";
export class CursorRuntimeError extends Error {
  constructor(
    readonly state: "missing-runtime" | "incompatible-runtime",
    readonly kind: "sdk" | "native-asset" | "version" = "sdk",
  ) {
    super(
      state === "missing-runtime"
        ? `Cursor ${kind === "native-asset" ? "native assets" : "SDK assets"} are missing. Reinstall the supported app build.`
        : "Cursor assets or Node runtime are incompatible. Reinstall the supported app build.",
    );
  }
}
export interface CursorAssets {
  sdk: string;
  worker: string;
  root: string;
  sdkVersion: string;
}
export function verifyCursorAssetDirectory(root: string): CursorAssets {
  try {
    const manifestPath = join(root, "assets.json");
    if (!existsSync(manifestPath))
      throw new CursorRuntimeError("missing-runtime");
    if (
      lstatSync(manifestPath).isSymbolicLink() ||
      lstatSync(manifestPath).size > 2097152
    )
      throw new CursorRuntimeError("incompatible-runtime");
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (
      m.sdkVersion !== CURSOR_SDK_VERSION ||
      m.platform !== process.platform ||
      m.arch !== process.arch ||
      !m.files ||
      typeof m.files !== "object"
    )
      throw new CursorRuntimeError("incompatible-runtime");
    const entries = Object.entries(m.files);
    if (entries.length < 10 || entries.length > 10000)
      throw new CursorRuntimeError("incompatible-runtime");
    const native = `node_modules/@cursor/sdk-${process.platform}-${process.arch}/`;
    const sdk = "node_modules/@cursor/sdk/dist/esm/index.js";
    if (
      !m.files[sdk] ||
      !m.files["worker.mjs"] ||
      !m.files["session-worker.mjs"] ||
      !Object.keys(m.files).some((p) => p.startsWith(native + "bin/rg")) ||
      !Object.keys(m.files).some((p) =>
        p.startsWith(native + "bin/cursorsandbox"),
      )
    )
      throw new CursorRuntimeError("incompatible-runtime");
    for (const [name, hash] of entries) {
      if (
        !/^[A-Za-z0-9_@.$+/-]+$/.test(name) ||
        name.startsWith("/") ||
        name.split("/").some((p) => !p || p === "." || p === "..") ||
        typeof hash !== "string" ||
        !/^[a-f0-9]{64}$/.test(hash)
      )
        throw new CursorRuntimeError("incompatible-runtime");
      const path = join(root, name);
      if (!existsSync(path))
        throw new CursorRuntimeError(
          "missing-runtime",
          name.startsWith(native) ? "native-asset" : "sdk",
        );
      let ancestor = root;
      for (const part of name.split("/")) {
        ancestor = join(ancestor, part);
        if (lstatSync(ancestor).isSymbolicLink())
          throw new CursorRuntimeError("incompatible-runtime");
      }
      if (
        !lstatSync(path).isFile() ||
        createHash("sha256").update(readFileSync(path)).digest("hex") !== hash
      )
        throw new CursorRuntimeError("incompatible-runtime");
    }
    return {
      sdk: join(root, sdk),
      worker: join(root, "worker.mjs"),
      root,
      sdkVersion: m.sdkVersion,
    };
  } catch (e) {
    if (e instanceof CursorRuntimeError) throw e;
    throw new CursorRuntimeError("missing-runtime");
  }
}
export function resolveCursorAssets(): CursorAssets {
  const main = managedEntry("cursor");
  if (main) return { sdk: managedEntry("cursor", "sdk")!, worker: managedEntry("cursor", "profileWorker")!, root: managedRoot("cursor")!, sdkVersion: CURSOR_SDK_VERSION };
  const base = dirname(fileURLToPath(import.meta.url));
  // Installed/bundled host has only the adjacent verified payload. No developer fallback.
  if (!base.endsWith(join("src", "cursor")))
    return verifyCursorAssetDirectory(join(base, "cursor"));
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve("@cursor/sdk");
    const sdk = join(dirname(dirname(entry)), "esm", "index.js");
    const root = dirname(dirname(dirname(sdk)));
    const meta = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (meta.version !== CURSOR_SDK_VERSION)
      throw new CursorRuntimeError("incompatible-runtime", "version");
    const native = require.resolve(
      `@cursor/sdk-${process.platform}-${process.arch}/package.json`,
    );
    const n = JSON.parse(readFileSync(native, "utf8"));
    if (n.version !== CURSOR_SDK_VERSION)
      throw new CursorRuntimeError("incompatible-runtime", "version");
    for (const name of ["rg", "cursorsandbox"])
      if (
        !existsSync(
          join(
            dirname(native),
            "bin",
            process.platform === "win32" ? name + ".exe" : name,
          ),
        )
      )
        throw new CursorRuntimeError("missing-runtime", "native-asset");
    return {
      sdk,
      root,
      worker: join(base, "worker.mjs"),
      sdkVersion: meta.version,
    };
  } catch (e) {
    if (e instanceof CursorRuntimeError) throw e;
    throw new CursorRuntimeError("missing-runtime");
  }
}
export interface CursorControlResult {
  ok: boolean;
  reason?: "auth-required" | "offline";
  models?: readonly {
    id: string;
    displayName: string;
    parameters?: unknown;
    variants?: unknown;
  }[];
  probe?: {
    durableAgent: boolean;
    nativeId: boolean;
    store: string;
    node: string;
  };
}
/** Each control request gets a profile-isolated process. Credentials never become process arguments or ambient env. */
export function cursorControl(
  assets: CursorAssets,
  env: NodeJS.ProcessEnv,
  action: "probe" | "read",
  key?: string,
  signal?: AbortSignal,
): Promise<CursorControlResult> {
  if (
    assets.sdkVersion !== CURSOR_SDK_VERSION ||
    Number(process.versions.node.split(".")[0]) < 24
  )
    return Promise.reject(
      new CursorRuntimeError("incompatible-runtime", "version"),
    );
  if (signal?.aborted)
    return Promise.reject(new Error("Control request cancelled"));
  return new Promise((resolve, reject) => {
    const owner = new NativeProcessOwner();
    const child = spawn(process.execPath, [assets.worker], {
      env,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    owner.own(child);
    let output = "";
    let settled = false;
    const finish = (error?: Error, result?: CursorControlResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      child.stdin.destroy();
      void owner.close().then(
        () => (error ? reject(error) : resolve(result!)),
        () => reject(new Error("Cursor worker cleanup failed")),
      );
    };
    const abort = () => finish(new Error("Control request cancelled"));
    const timer = setTimeout(
      () => finish(new Error("Cursor control request timed out")),
      10000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output) > 1048576)
        finish(new Error("Cursor control response exceeds capacity"));
    });
    child.on("error", () => finish(new CursorRuntimeError("missing-runtime")));
    child.stdin.on("error", () =>
      finish(new Error("Cursor control input unavailable")),
    );
    child.on("close", (code) => {
      if (settled) return;
      try {
        const v = JSON.parse(output);
        if (
          code !== 0 ||
          typeof v.ok !== "boolean" ||
          (!v.ok && !["auth-required", "offline"].includes(v.reason))
        )
          throw new Error();
        finish(undefined, v);
      } catch {
        finish(new Error("Cursor control response unavailable"));
      }
    });
    if (signal?.aborted) {
      abort();
      return;
    }
    child.stdin.end(JSON.stringify({ sdk: assets.sdk, action, key }));
  });
}
