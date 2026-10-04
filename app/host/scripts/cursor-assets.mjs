import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  lstatSync,
} from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
function packageRoot(entry) {
  let root = dirname(entry);
  while (root !== dirname(root)) {
    try {
      const meta = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      if (meta.name) return root;
    } catch {}
    root = dirname(root);
  }
  throw new Error("SDK dependency package root missing");
}
export function packageCursorAssets(destination) {
  const output = join(destination, "cursor");
  mkdirSync(output, { recursive: true });
  const visited = new Set();
  function copyPackage(root) {
    const meta = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (visited.has(meta.name)) return;
    visited.add(meta.name);
    if (meta.name.startsWith("@cursor/sdk") && meta.version !== "1.0.35")
      throw new Error("Unsupported Cursor SDK assets");
    const target = join(output, "node_modules", meta.name);
    cpSync(root, target, {
      recursive: true,
      dereference: false,
      filter: (path) =>
        !relative(root, path).split("/").includes("node_modules"),
    });
    const resolver = createRequire(join(root, "package.json"));
    for (const dep of Object.keys(meta.dependencies ?? {}))
      copyPackage(packageRoot(resolver.resolve(dep)));
  }
  copyPackage(packageRoot(require.resolve("@cursor/sdk")));
  copyPackage(
    packageRoot(
      require.resolve(
        `@cursor/sdk-${process.platform}-${process.arch}/package.json`,
      ),
    ),
  );
  cpSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../src/cursor/worker.mjs",
    ),
    join(output, "worker.mjs"),
  );
  const files = {};
  function walk(path) {
    for (const name of readdirSync(path)) {
      if (path === output && name === "assets.json") continue;
      const file = join(path, name),
        stat = lstatSync(file);
      if (stat.isSymbolicLink())
        throw new Error("SDK asset links are unsupported");
      if (stat.isDirectory()) walk(file);
      else
        files[relative(output, file).split("\\").join("/")] = createHash(
          "sha256",
        )
          .update(readFileSync(file))
          .digest("hex");
    }
  }
  walk(output);
  // Keep all native binaries, parser assets, lazy chunks and dependency licenses.
  writeFileSync(
    join(output, "assets.json"),
    JSON.stringify(
      {
        sdkVersion: "1.0.35",
        platform: process.platform,
        arch: process.arch,
        files,
      },
      null,
      2,
    ) + "\n",
  );
}
