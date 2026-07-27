export const DEFAULT_UNTITLED_TITLE = "Untitled";

/** Windows device names that cannot be used as a bare filename. */
const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export function deriveUntitledTitle(content: string): string {
  const firstLine = (content.split(/\r?\n/, 1)[0] ?? "").trim();
  if (!firstLine) {
    return DEFAULT_UNTITLED_TITLE;
  }
  return Array.from(firstLine).slice(0, 64).join("");
}

/**
 * Filename-safe form of {@link deriveUntitledTitle} for Save / Save As defaults.
 * Strips path separators and other illegal characters so `join(workspaceRoot, name)`
 * cannot escape the workspace (e.g. a leading `/`) or produce an invalid path.
 */
export function deriveUntitledFilename(content: string): string {
  const title = deriveUntitledTitle(content);
  const sanitized = Array.from(title)
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code < 32) {
        return "-";
      }
      if ('<>:"/\\|?*'.includes(char)) {
        return "-";
      }
      return char;
    })
    .join("")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\.+$/g, "")
    .trim();
  if (!sanitized) {
    return DEFAULT_UNTITLED_TITLE;
  }
  const base = sanitized.split(".")[0] ?? sanitized;
  if (WINDOWS_RESERVED_NAMES.has(base.toUpperCase())) {
    return DEFAULT_UNTITLED_TITLE;
  }
  return sanitized;
}
