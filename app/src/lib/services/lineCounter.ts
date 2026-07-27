import { readDir, readFile, stat, type DirEntry } from "@tauri-apps/plugin-fs";
import { normalizePathSync } from "./diskFingerprint";
import { joinDirectoryPath } from "./folderOpenableFiles";

/**
 * Line counter — recursive workspace walk that counts newline bytes (`\n`,
 * i.e. `wc -l` semantics) in files whose extension is in the code allowlist,
 * prunes dot-dirs and the standard dependency/build folders, and aggregates a
 * grand total plus per-file and ignored-file lists.
 *
 * The pure helpers (`extensionOf`, `isCountedExtension`, `countNewlines`,
 * `classifyExtension`) are exported for unit testing; the IO entry point is
 * {@link countLinesInWorkspace}.
 */

/**
 * Code extensions counted by the LineWalker allowlist. Markdown / JSON /
 * YAML / TOML are intentionally excluded (they are data/docs, not source).
 * Lookups are case-insensitive.
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

/** Default maximum file size before skipping (5 MiB). */
export const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Soft caps on retained detail lists (totals still count beyond the cap). */
export const MAX_LISTED_CODE_FILES = 10_000;
export const MAX_LISTED_IGNORED_FILES = 5_000;
export const MAX_LISTED_SKIPPED_DIRS = 2_000;
export const MAX_LISTED_READ_ERRORS = 500;

const YIELD_EVERY_FILES = 50;

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
  /** Accurate counts when detail arrays are truncated. */
  codeFileCount: number;
  ignoredFileCount: number;
  skippedDirCount: number;
  readErrorCount: number;
}

export interface CountLinesProgress {
  relPath: string;
  filesScanned: number;
}

export interface CountLinesOptions {
  signal?: AbortSignal;
  onProgress?: (info: CountLinesProgress) => void;
  maxFileBytes?: number;
}

/**
 * Returns the extension (lowercased, without the leading dot) or an empty
 * string when there is no extension.
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
 * newline therefore undercount their last line, matching `wc -l` semantics.
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

function cacheKey(root: string): string {
  return normalizePathSync(root).replace(/\/+$/, "");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Line count aborted", "AbortError");
  }
}

function emptyResult(): LineCountResult {
  return {
    totalLines: 0,
    codeFiles: [],
    ignoredFiles: [],
    skippedDirs: [],
    readErrors: [],
    codeFileCount: 0,
    ignoredFileCount: 0,
    skippedDirCount: 0,
    readErrorCount: 0,
  };
}

function pushCapped<T>(list: T[], item: T, max: number): void {
  if (list.length < max) {
    list.push(item);
  }
}

interface WalkAccumulator {
  result: LineCountResult;
  seenSkipped: Set<string>;
}

interface WalkContext {
  root: string;
  signal?: AbortSignal;
  onProgress?: CountLinesOptions["onProgress"];
  maxFileBytes: number;
  filesScanned: number;
  acc: WalkAccumulator;
}

async function walkDir(ctx: WalkContext, dir: string): Promise<void> {
  throwIfAborted(ctx.signal);

  let entries: DirEntry[];
  try {
    entries = await readDir(dir);
  } catch (error) {
    ctx.acc.result.readErrorCount += 1;
    pushCapped(
      ctx.acc.result.readErrors,
      `${dir}: ${String(error)}`,
      MAX_LISTED_READ_ERRORS,
    );
    return;
  }

  for (const entry of entries) {
    throwIfAborted(ctx.signal);

    if (shouldSkipEntry(entry)) {
      continue;
    }
    const name = entry.name;
    const fullPath = joinDirectoryPath(dir, name);
    const rel = toRelPath(ctx.root, fullPath);

    if (entry.isDirectory) {
      if (isDotDir(name) || isPrunedDir(name)) {
        if (ctx.acc.seenSkipped.add(rel)) {
          ctx.acc.result.skippedDirCount += 1;
          pushCapped(ctx.acc.result.skippedDirs, rel, MAX_LISTED_SKIPPED_DIRS);
        }
        continue;
      }
      await walkDir(ctx, fullPath);
      continue;
    }

    if (!entry.isFile) {
      continue;
    }

    const ext = extensionOf(fullPath);
    if (ext === "") {
      ctx.acc.result.ignoredFileCount += 1;
      pushCapped(
        ctx.acc.result.ignoredFiles,
        { relPath: rel, reason: "no extension" },
        MAX_LISTED_IGNORED_FILES,
      );
      continue;
    }
    if (!isCountedExtension(ext)) {
      ctx.acc.result.ignoredFileCount += 1;
      pushCapped(
        ctx.acc.result.ignoredFiles,
        { relPath: rel, reason: "non-code extension" },
        MAX_LISTED_IGNORED_FILES,
      );
      continue;
    }

    try {
      const info = await stat(fullPath);
      if (info.size > ctx.maxFileBytes) {
        ctx.acc.result.readErrorCount += 1;
        pushCapped(
          ctx.acc.result.readErrors,
          `${rel}: skipped (file exceeds ${ctx.maxFileBytes} bytes)`,
          MAX_LISTED_READ_ERRORS,
        );
        continue;
      }
    } catch (error) {
      ctx.acc.result.readErrorCount += 1;
      pushCapped(
        ctx.acc.result.readErrors,
        `${rel}: ${String(error)}`,
        MAX_LISTED_READ_ERRORS,
      );
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = await readFile(fullPath);
    } catch (error) {
      ctx.acc.result.readErrorCount += 1;
      pushCapped(
        ctx.acc.result.readErrors,
        `${rel}: ${String(error)}`,
        MAX_LISTED_READ_ERRORS,
      );
      continue;
    }

    const lines = countNewlines(bytes);
    ctx.acc.result.codeFileCount += 1;
    pushCapped(
      ctx.acc.result.codeFiles,
      { relPath: rel, ext, lines },
      MAX_LISTED_CODE_FILES,
    );
    ctx.acc.result.totalLines += lines;

    ctx.filesScanned++;
    ctx.onProgress?.({ relPath: rel, filesScanned: ctx.filesScanned });

    if (ctx.filesScanned % YIELD_EVERY_FILES === 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }
}

async function countLinesInWorkspaceInternal(
  root: string,
  options?: CountLinesOptions,
): Promise<LineCountResult> {
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  throwIfAborted(options?.signal);

  const acc: WalkAccumulator = {
    result: emptyResult(),
    seenSkipped: new Set(),
  };

  const ctx: WalkContext = {
    root: normalizedRoot,
    signal: options?.signal,
    onProgress: options?.onProgress,
    maxFileBytes: options?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    filesScanned: 0,
    acc,
  };

  await walkDir(ctx, normalizedRoot);
  throwIfAborted(options?.signal);

  acc.result.codeFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
  acc.result.ignoredFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
  acc.result.skippedDirs.sort((a, b) => a.localeCompare(b));
  return acc.result;
}

interface InflightWalk {
  promise: Promise<LineCountResult>;
  /** Callers currently awaiting this walk; walk aborts only when the last one leaves. */
  consumers: number;
  walkController: AbortController;
}

const inflightByRoot = new Map<string, InflightWalk>();

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(new DOMException("Line count aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new DOMException("Line count aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Walks `root` and counts newline bytes in every allowlisted code file.
 * Dot-dirs and the standard dependency/build folders are pruned; symlinks are
 * skipped. Results are sorted alphabetically by relative path for stable
 * output.
 *
 * Concurrent calls for the same normalized root share one in-flight walk.
 * Aborting one caller rejects only that caller; the walk continues until every
 * consumer has aborted or the walk finishes.
 */
export async function countLinesInWorkspace(
  root: string,
  options?: CountLinesOptions,
): Promise<LineCountResult> {
  const key = cacheKey(root);
  let entry = inflightByRoot.get(key);
  if (!entry) {
    const walkController = new AbortController();
    const promise = countLinesInWorkspaceInternal(root, {
      maxFileBytes: options?.maxFileBytes,
      onProgress: options?.onProgress,
      signal: walkController.signal,
    }).finally(() => {
      if (inflightByRoot.get(key)?.promise === promise) {
        inflightByRoot.delete(key);
      }
    });
    entry = { promise, consumers: 0, walkController };
    inflightByRoot.set(key, entry);
  }

  entry.consumers += 1;
  const signal = options?.signal;
  const onAbort = (): void => {
    entry!.consumers -= 1;
    if (entry!.consumers <= 0) {
      entry!.walkController.abort();
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await raceWithAbort(entry.promise, signal);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // If this caller finished without aborting, drop our consumer slot so a
    // later abort from another caller can still cancel a lingering walk.
    if (!signal?.aborted) {
      entry.consumers = Math.max(0, entry.consumers - 1);
    }
  }
}

/** Clears in-flight walks (for unit tests). */
export function clearLineCounterInflight(): void {
  inflightByRoot.clear();
}
