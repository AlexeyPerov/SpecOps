import { join } from "@tauri-apps/api/path";
import { readDir, readFile, type DirEntry } from "@tauri-apps/plugin-fs";

/**
 * Line counter — a TypeScript port of the Unity-AI-Hub `line_count.rs`
 * LineWalker algorithm. It counts newline bytes (`\n`, i.e. `wc -l`
 * semantics) in files whose extension is in the code allowlist, prunes
 * dot-dirs and the standard dependency/build folders, and aggregates a
 * grand total plus per-file and ignored-file lists.
 *
 * The pure helpers (`extensionOf`, `isCountedExtension`, `countNewlines`,
 * `classifyExtension`) are exported for unit testing; the IO entry point is
 * {@link countLinesInWorkspace}.
 */

/**
 * Code extensions counted by the LineWalker allowlist. Markdown / JSON /
 * YAML / TOML are intentionally excluded (they are data/docs, not source).
 * Lookups are case-insensitive. Kept in sync with the Rust original.
 */
const COUNTED_EXTENSIONS: ReadonlySet<string> = new Set([
  "c", "cc", "cpp", "cxx", "h", "hpp", "hh", "go", "rs", "py", "pyw", "js",
  "mjs", "cjs", "ts", "tsx", "jsx", "java", "kt", "kts", "swift", "rb", "php",
  "cs", "sql", "sh", "bash", "zsh", "ps1", "html", "htm", "css", "scss", "sass",
  "less", "vue", "svelte", "mdx", "scala", "clj", "cljs", "ex", "exs", "erl",
  "hrl", "dart", "lua", "r", "pl", "pm", "vim", "cls", "zig", "nim", "ml",
  "mli", "fs", "fsi", "asm", "s", "proto", "graphql", "gql",
]);

/** Directory basenames pruned unconditionally (subtree never walked). */
const PRUNED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  "node_modules", "vendor", "dist", "build", "target", "__pycache__",
]);

export interface CodeFile {
  relPath: string;
  ext: string;
  lines: number;
}

export interface IgnoredFile {
  relPath: string;
  reason: string;
}

export interface LineCountResult {
  totalLines: number;
  codeFiles: CodeFile[];
  ignoredFiles: IgnoredFile[];
  skippedDirs: string[];
  readErrors: string[];
}

/**
 * Returns the extension (lowercased, without the leading dot) or an empty
 * string when there is no extension. Mirrors the Rust `extension_of`.
 */
export function extensionOf(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const slashIndex = normalized.lastIndexOf("/");
  const basename = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex <= 0) {
    return "";
  }
  return basename.slice(dotIndex + 1).toLowerCase();
}

/** Whether a (lowercased, dot-less) extension is in the code allowlist. */
export function isCountedExtension(ext: string): boolean {
  return COUNTED_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Counts newline (`\n`) bytes in a `Uint8Array`. Files without a trailing
 * newline therefore undercount their last line, matching `wc -l` and the
 * LineWalker algorithm exactly.
 */
export function countNewlines(bytes: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      count++;
    }
  }
  return count;
}

/** Classifies an extension into the three buckets the walker reports. */
export function classifyExtension(ext: string): "counted" | "no-extension" | "ignored" {
  if (ext === "") {
    return "no-extension";
  }
  return isCountedExtension(ext) ? "counted" : "ignored";
}

function isDotDir(basename: string): boolean {
  return basename.startsWith(".") && basename !== ".";
}

function isPrunedDir(basename: string): boolean {
  return PRUNED_DIRECTORY_NAMES.has(basename.toLowerCase());
}

function shouldSkipEntry(entry: DirEntry): boolean {
  return entry.isSymlink;
}

function toRelPath(root: string, fullPath: string): string {
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  let rel = fullPath;
  if (fullPath.startsWith(normalizedRoot)) {
    rel = fullPath.slice(normalizedRoot.length);
  }
  rel = rel.replace(/^[\\/]+/, "").replaceAll("\\", "/");
  return rel;
}

interface WalkAccumulator {
  result: LineCountResult;
  seenSkipped: Set<string>;
}

async function walkDir(
  root: string,
  dir: string,
  acc: WalkAccumulator,
): Promise<void> {
  let entries: DirEntry[];
  try {
    entries = await readDir(dir);
  } catch (error) {
    acc.result.readErrors.push(`${dir}: ${String(error)}`);
    return;
  }

  for (const entry of entries) {
    if (shouldSkipEntry(entry)) {
      continue;
    }
    const name = entry.name;
    const fullPath = await join(dir, name);
    const rel = toRelPath(root, fullPath);

    if (entry.isDirectory) {
      if (isDotDir(name) || isPrunedDir(name)) {
        if (acc.seenSkipped.add(rel)) {
          acc.result.skippedDirs.push(rel);
        }
        continue;
      }
      await walkDir(root, fullPath, acc);
      continue;
    }

    if (!entry.isFile) {
      continue;
    }

    const ext = extensionOf(fullPath);
    if (ext === "") {
      acc.result.ignoredFiles.push({ relPath: rel, reason: "no extension" });
      continue;
    }
    if (!isCountedExtension(ext)) {
      acc.result.ignoredFiles.push({ relPath: rel, reason: "non-code extension" });
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = await readFile(fullPath);
    } catch (error) {
      acc.result.readErrors.push(`${rel}: ${String(error)}`);
      continue;
    }
    const lines = countNewlines(bytes);
    acc.result.codeFiles.push({ relPath: rel, ext, lines });
    acc.result.totalLines += lines;
  }
}

/**
 * Walks `root` and counts newline bytes in every allowlisted code file.
 * Dot-dirs and the standard dependency/build folders are pruned; symlinks are
 * skipped. Results are sorted alphabetically by relative path for stable
 * output (matching the Rust original).
 */
export async function countLinesInWorkspace(root: string): Promise<LineCountResult> {
  const acc: WalkAccumulator = {
    result: {
      totalLines: 0,
      codeFiles: [],
      ignoredFiles: [],
      skippedDirs: [],
      readErrors: [],
    },
    seenSkipped: new Set(),
  };
  await walkDir(root.replace(/[\\/]+$/, ""), root.replace(/[\\/]+$/, ""), acc);
  acc.result.codeFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
  acc.result.ignoredFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
  acc.result.skippedDirs.sort((a, b) => a.localeCompare(b));
  return acc.result;
}
