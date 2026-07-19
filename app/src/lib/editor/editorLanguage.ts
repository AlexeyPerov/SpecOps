import { LanguageSupport, StreamLanguage } from "@codemirror/language";
export type EditorLanguageId = string;

const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".bmp",
  ".avif",
  ".heic",
  ".heif",
] as const;

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
  for (const extension of IMAGE_EXTENSIONS) {
    if (lower.endsWith(extension)) {
      return true;
    }
  }
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

// Module-level cache of resolved LanguageSupport instances. Populated by
// loadLanguageSupport; getLanguageSupport is a pure cache lookup. All language
// packs (including the formerly-sync markdown/javascript/html/css) are loaded
// via dynamic import so they land in separate chunks and stay out of the
// initial bundle — they're only needed once a file of that language is opened.
const cache = new Map<string, LanguageSupport>();

/**
 * Returns the cached LanguageSupport for `id`, or null if it hasn't been
 * loaded yet. Callers that need the support (e.g. the editor controller's
 * `syncLanguage`) fall back to {@link loadLanguageSupport} on a miss, which
 * fetches the language chunk and reconfigures the editor when it resolves.
 */
export function getLanguageSupport(id: EditorLanguageId): LanguageSupport | null {
  if (id === "plaintext") return null;
  return cache.get(id) ?? null;
}

export async function loadLanguageSupport(id: EditorLanguageId): Promise<LanguageSupport | null> {
  if (id === "plaintext") return null;

  const cached = cache.get(id);
  if (cached) return cached;

  let support: LanguageSupport | null = null;

  try {
    switch (id) {
      case "markdown": {
        const mod = await import("@codemirror/lang-markdown");
        support = mod.markdown({ addKeymap: false });
        break;
      }
      case "javascript": {
        const mod = await import("@codemirror/lang-javascript");
        support = mod.javascript();
        break;
      }
      case "typescript": {
        const mod = await import("@codemirror/lang-javascript");
        support = mod.javascript({ typescript: true, jsx: true });
        break;
      }
      case "jsx": {
        const mod = await import("@codemirror/lang-javascript");
        support = mod.javascript({ jsx: true });
        break;
      }
      case "shell": {
        const mod = await import("@codemirror/lang-javascript");
        support = mod.javascript();
        break;
      }
      case "html": {
        const mod = await import("@codemirror/lang-html");
        support = mod.html();
        break;
      }
      case "css": {
        const mod = await import("@codemirror/lang-css");
        support = mod.css();
        break;
      }
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
