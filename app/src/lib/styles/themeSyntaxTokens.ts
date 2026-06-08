export interface ThemeSyntaxPalette {
  keyword: string;
  string: string;
  comment: string;
  number: string;
  type: string;
  heading: string;
  link: string;
  markup: string;
  punctuation: string;
}

export const SYNTAX_PALETTE_CSS_VARS = [
  "keyword",
  "string",
  "comment",
  "number",
  "type",
  "heading",
  "link",
  "markup",
  "punctuation",
] as const satisfies ReadonlyArray<keyof ThemeSyntaxPalette>;

function parseHex(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

export function mixHex(colorA: string, colorB: string, ratio: number): string {
  const a = parseHex(colorA);
  const b = parseHex(colorB);
  return toHex(
    a.r + (b.r - a.r) * ratio,
    a.g + (b.g - a.g) * ratio,
    a.b + (b.b - a.b) * ratio,
  );
}

export function syntaxPaletteToTokens(
  palette: ThemeSyntaxPalette,
): Record<`syntax-${keyof ThemeSyntaxPalette}`, string> {
  const tokens = {} as Record<`syntax-${keyof ThemeSyntaxPalette}`, string>;
  for (const key of SYNTAX_PALETTE_CSS_VARS) {
    tokens[`syntax-${key}`] = palette[key];
  }
  return tokens;
}
