/**
 * Text decode/encode for editable documents.
 *
 * The editor works exclusively in LF with no BOM: CodeMirror normalizes its document to
 * LF regardless of what it is handed, so keeping the store in any other shape means the
 * store and the editor doc can never compare equal. Anything the file needs that LF
 * cannot express — its line ending, its BOM — is captured here as metadata at open time
 * and re-applied at write time, so a round-trip through the editor does not silently
 * rewrite the file.
 */

/** Byte-order-mark code point, as decoded from EF BB BF. */
const BOM = "﻿";

export type DocumentLineEnding = "lf" | "crlf";

export type DecodedTextFile = {
  /** Content normalized to LF with any BOM stripped. Safe to hand to the editor. */
  content: string;
  lineEnding: DocumentLineEnding;
  /** True when the file started with a UTF-8 BOM, which is restored on write. */
  hasBom: boolean;
};

/**
 * Decode UTF-8 bytes strictly.
 *
 * Returns null when the bytes are not valid UTF-8. Callers must treat that as "not
 * editable text" rather than falling back to a lossy decode: a lossy decode replaces
 * every invalid byte with U+FFFD, and writing that buffer back destroys the file. This
 * is the difference between viewing a UTF-16 or `.so` file and corrupting it on Cmd+S.
 */
export function decodeTextFile(bytes: Uint8Array): DecodedTextFile | null {
  let decoded: string;
  try {
    // `ignoreBOM: true` is a misnomer in the spec: it means "do not consume the BOM",
    // i.e. leave U+FEFF in the output. Without it TextDecoder silently swallows the
    // BOM and there is no way to tell a BOM-prefixed file from a plain one — which is
    // how BOMs were being dropped on the first save.
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }

  const hasBom = decoded.startsWith(BOM);
  const withoutBom = hasBom ? decoded.slice(BOM.length) : decoded;
  return {
    content: normalizeToLf(withoutBom),
    lineEnding: detectLineEnding(withoutBom),
    hasBom,
  };
}

/**
 * Re-apply `lineEnding` and `hasBom` to editor content on its way to disk.
 *
 * `content` is expected to be LF-only (what the editor produces). CRLF conversion is
 * done from LF rather than by patching `\r`-less newlines, so a buffer that somehow
 * contains stray CRLFs still ends up uniformly CRLF instead of mixed.
 */
export function encodeTextFile(
  content: string,
  options: { lineEnding: DocumentLineEnding; hasBom: boolean },
): string {
  const withLineEndings =
    options.lineEnding === "crlf" ? normalizeToLf(content).replaceAll("\n", "\r\n") : content;
  return options.hasBom ? `${BOM}${withLineEndings}` : withLineEndings;
}

/** Collapse CRLF and lone CR to LF. */
export function normalizeToLf(content: string): string {
  return content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

/**
 * Classify a file's dominant line ending.
 *
 * A file is CRLF when it has at least one CRLF and no more LF-only lines than CRLF
 * ones. Mixed files therefore round-trip to whichever style already dominates instead
 * of being rewritten wholesale, and a file with no newline at all stays LF.
 */
export function detectLineEnding(content: string): DocumentLineEnding {
  const crlfCount = countOccurrences(content, "\r\n");
  if (crlfCount === 0) {
    return "lf";
  }
  const totalLf = countOccurrences(content, "\n");
  const bareLfCount = totalLf - crlfCount;
  return crlfCount >= bareLfCount ? "crlf" : "lf";
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}
