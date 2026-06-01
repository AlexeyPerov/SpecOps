export const DEFAULT_UNTITLED_TITLE = "Untitled";

export function deriveUntitledTitle(content: string): string {
  const firstLine = (content.split(/\r?\n/, 1)[0] ?? "").trim();
  if (!firstLine) {
    return DEFAULT_UNTITLED_TITLE;
  }
  return Array.from(firstLine).slice(0, 64).join("");
}
