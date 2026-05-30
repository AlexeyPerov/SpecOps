export function deriveUntitledTitle(content: string): string {
  const firstLine = (content.split(/\r?\n/, 1)[0] ?? "").trim();
  if (!firstLine) {
    return "Untitled";
  }
  return Array.from(firstLine).slice(0, 64).join("");
}
