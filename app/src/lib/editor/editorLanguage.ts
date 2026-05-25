import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { LanguageSupport, StreamLanguage } from "@codemirror/language";
export type EditorLanguageId = string;

const EXTENSION_MAP: Record<string, EditorLanguageId> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".jsx": "jsx",
  ".json": "json",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sh": "shell",
  ".bash": "shell",
  ".xml": "xml",
  ".toml": "toml",
  ".sql": "sql",
  ".dart": "dart",
  ".svelte": "svelte",
  ".cs": "csharp",
};

export const OPENABLE_FILE_EXTENSIONS = [...Object.keys(EXTENSION_MAP), ".txt"] as const;

const EXTENSIONLESS_OPENABLE_NAMES = new Set([
  "readme",
  "license",
  "licence",
  "changelog",
  "makefile",
  "dockerfile",
  "gemfile",
  "rakefile",
  "procfile",
  "cmakelists.txt",
]);

function fileBasename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? path;
}

export function isOpenableFilePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  for (const extension of OPENABLE_FILE_EXTENSIONS) {
    if (lower.endsWith(extension)) {
      return true;
    }
  }
  const base = fileBasename(filePath);
  if (EXTENSIONLESS_OPENABLE_NAMES.has(base.toLowerCase())) {
    return true;
  }
  // Plain-text notes often have no extension (e.g. Apple Notes exports).
  if (!base.includes(".")) {
    return true;
  }
  return false;
}

export function inferEditorLanguage(path: string | null): EditorLanguageId {
  if (!path) return "plaintext";
  const lower = path.toLowerCase();
  for (const [ext, lang] of Object.entries(EXTENSION_MAP)) {
    if (lower.endsWith(ext)) return lang;
  }
  return "plaintext";
}

const cache = new Map<string, LanguageSupport>();

function syncMarkdown(): LanguageSupport {
  let cached = cache.get("markdown");
  if (!cached) {
    cached = markdown({ addKeymap: false });
    cache.set("markdown", cached);
  }
  return cached;
}

function syncJavascript(id: "javascript" | "typescript" | "jsx" | "shell"): LanguageSupport {
  let cached = cache.get(id);
  if (!cached) {
    if (id === "typescript") cached = javascript({ typescript: true, jsx: true });
    else if (id === "jsx") cached = javascript({ jsx: true });
    else cached = javascript();
    cache.set(id, cached);
  }
  return cached;
}

function syncHtml(): LanguageSupport {
  let cached = cache.get("html");
  if (!cached) {
    cached = html();
    cache.set("html", cached);
  }
  return cached;
}

function syncCss(): LanguageSupport {
  let cached = cache.get("css");
  if (!cached) {
    cached = css();
    cache.set("css", cached);
  }
  return cached;
}

const SYNC_LANGUAGE_IDS = new Set<EditorLanguageId>([
  "markdown",
  "javascript",
  "typescript",
  "jsx",
  "shell",
  "html",
  "css",
]);

export function getLanguageSupport(id: EditorLanguageId): LanguageSupport | null {
  if (id === "plaintext") return null;
  if (id === "markdown") return syncMarkdown();
  if (id === "javascript" || id === "typescript" || id === "jsx" || id === "shell") {
    return syncJavascript(id);
  }
  if (id === "html") return syncHtml();
  if (id === "css") return syncCss();
  const cached = cache.get(id);
  if (cached) return cached;
  return null;
}

export async function loadLanguageSupport(id: EditorLanguageId): Promise<LanguageSupport | null> {
  if (id === "plaintext") return null;
  if (SYNC_LANGUAGE_IDS.has(id)) return getLanguageSupport(id);

  const cached = cache.get(id);
  if (cached) return cached;

  let support: LanguageSupport | null = null;

  try {
    switch (id) {
      case "json": {
        const mod = await import("@codemirror/lang-json");
        support = mod.json();
        break;
      }
      case "python": {
        const mod = await import("@codemirror/lang-python");
        support = mod.python();
        break;
      }
      case "rust": {
        const mod = await import("@codemirror/lang-rust");
        support = mod.rust();
        break;
      }
      case "go": {
        const mod = await import("@codemirror/lang-go");
        support = mod.go();
        break;
      }
      case "yaml": {
        const mod = await import("@codemirror/lang-yaml");
        support = mod.yaml();
        break;
      }
      case "xml": {
        const mod = await import("@codemirror/lang-xml");
        support = mod.xml();
        break;
      }
      case "sql": {
        const mod = await import("@codemirror/lang-sql");
        support = mod.sql();
        break;
      }
      case "toml": {
        const { toml } = await import("@codemirror/legacy-modes/mode/toml");
        support = new LanguageSupport(StreamLanguage.define(toml));
        break;
      }
      case "svelte": {
        const mod = await import("@replit/codemirror-lang-svelte");
        support = mod.svelte();
        break;
      }
      case "csharp": {
        const mod = await import("@replit/codemirror-lang-csharp");
        support = mod.csharp();
        break;
      }
    }
  } catch {
    return null;
  }

  if (support) {
    cache.set(id, support);
  }
  return support;
}
