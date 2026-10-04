import {
  copyFileSync,
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
export function packageClaudeAssets(destination) {
  const require = createRequire(import.meta.url);
  const sdk = dirname(require.resolve("@anthropic-ai/claude-agent-sdk"));
  const meta = JSON.parse(readFileSync(join(sdk, "package.json"), "utf8"));
  if (meta.version !== "0.3.289" || meta.claudeCodeVersion !== "2.1.289")
    throw new Error("Unsupported Claude SDK assets");
  const binaryName = process.platform === "win32" ? "claude.exe" : "claude";
  const binary = require.resolve(
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${binaryName}`,
  );
  const nativeMeta = JSON.parse(
    readFileSync(join(dirname(binary), "package.json"), "utf8"),
  );
  if (nativeMeta.version !== meta.version)
    throw new Error("Mismatched Claude native asset package");
  const output = join(destination, "claude");
  mkdirSync(output, { recursive: true });
  const hashes = {};
  function copy(source, name) {
    copyFileSync(source, join(output, name));
    hashes[name] = createHash("sha256")
      .update(readFileSync(source))
      .digest("hex");
  }
  // The official root entry inlines peers. Preserve every distributed JS chunk and manifest
  // alongside it so dynamic helpers remain resolvable with no node_modules directory.
  for (const name of readdirSync(sdk).filter((name) =>
    /\.(?:mjs|js|json|md)$/.test(name),
  ))
    copy(join(sdk, name), name);
  copy(binary, binaryName);
  chmodSync(join(output, binaryName), 0o755);
  copy(join(dirname(binary), "LICENSE.md"), "NATIVE-LICENSE.md");
  writeFileSync(
    join(output, "assets.json"),
    JSON.stringify(
      {
        sdkVersion: meta.version,
        nativeVersion: meta.claudeCodeVersion,
        platform: process.platform,
        arch: process.arch,
        files: hashes,
      },
      null,
      2,
    ) + "\n",
  );
}
