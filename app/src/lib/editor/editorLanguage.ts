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

export function getLanguageSupport(id: EditorLanguageId): LanguageSupport | null {
  if (id === "plaintext") return null;
  if (id === "markdown") return syncMarkdown();
  const cached = cache.get(id);
  if (cached) return cached;
  return null;
}

export async function loadLanguageSupport(id: EditorLanguageId): Promise<LanguageSupport | null> {
  if (id === "plaintext") return null;
  if (id === "markdown") return syncMarkdown();

  const cached = cache.get(id);
  if (cached) return cached;

  let support: LanguageSupport | null = null;

  try {
    switch (id) {
      case "javascript":
      case "typescript":
      case "jsx": {
        const mod = await import("@codemirror/lang-javascript");
        if (id === "typescript") support = mod.javascript({ typescript: true });
        else if (id === "jsx") support = mod.javascript({ jsx: true });
        else support = mod.javascript();
        break;
      }
      case "json": {
        const mod = await import("@codemirror/lang-json");
        support = mod.json();
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
      case "shell": {
        const mod = await import("@codemirror/lang-javascript");
        support = mod.javascript();
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
