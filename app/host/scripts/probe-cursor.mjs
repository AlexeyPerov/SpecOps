// No-account control probe of copied host assets, outside checkout/module resolution.
import { cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const host = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = mkdtempSync(join(tmpdir(), "specops-cursor-installed-probe-"));
try {
  const payload = join(root, "cursor");
  cpSync(join(host, "dist/cursor"), payload, { recursive: true });
  const node = join(root, process.platform === "win32" ? "node.exe" : "node");
  cpSync(process.execPath, node);
  const home = join(root, "profile");
  mkdirSync(join(home, "native"), { recursive: true, mode: 0o700 });
  const env = {
    HOME: home,
    USERPROFILE: home,
    PATH:
      process.platform === "win32" ? process.env.SystemRoot : "/usr/bin:/bin",
    ...(process.platform === "win32"
      ? { SystemRoot: process.env.SystemRoot }
      : {}),
  };
  const sdk = join(payload, "node_modules/@cursor/sdk/dist/esm/index.js");
  const worker = spawnSync(node, [join(payload, "worker.mjs")], {
    cwd: root,
    env,
    input: JSON.stringify({ sdk, action: "probe" }),
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1048576,
  });
  if (
    worker.status !== 0 ||
    worker.stderr ||
    !JSON.parse(worker.stdout).probe?.durableAgent
  )
    throw new Error("Copied native SDK control probe failed");
  const native = join(
    payload,
    `node_modules/@cursor/sdk-${process.platform}-${process.arch}`,
    "bin",
  );
  const rg = spawnSync(
    join(native, process.platform === "win32" ? "rg.exe" : "rg"),
    ["--version"],
    { cwd: root, env, encoding: "utf8", timeout: 3000, maxBuffer: 4096 },
  );
  if (rg.status !== 0 || !rg.stdout.startsWith("ripgrep "))
    throw new Error("Copied native search asset failed");
  const helper = spawnSync(
    join(
      native,
      process.platform === "win32" ? "cursorsandbox.exe" : "cursorsandbox",
    ),
    ["--help"],
    { cwd: root, env, encoding: "utf8", timeout: 3000, maxBuffer: 16384 },
  );
  if (helper.error) throw new Error("Copied native sandbox helper unavailable");
  console.log(
    JSON.stringify({
      sdkVersion: "1.0.35",
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      durableLocalAgent: true,
      store: "jsonl",
      nativeSearch: true,
      nativeSandboxExecutable: true,
      sandboxEnforcement: "unverified",
      inference: false,
      authentication: false,
      installedSignedApp: false,
    }),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
