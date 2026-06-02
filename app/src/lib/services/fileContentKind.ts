export type FileContentKind = "text" | "image" | "binary";

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

const BINARY_SAMPLE_BYTES = 8192;

export function isImageFilePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function isBinaryBytes(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, BINARY_SAMPLE_BYTES));
  if (sample.length === 0) {
    return false;
  }
  if (sample.includes(0)) {
    return true;
  }
  let controlChars = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) {
      controlChars += 1;
    }
  }
  return controlChars / sample.length > 0.3;
}

export function sniffImageFilePath(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return true;
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return true;
  }
  if (bytes.length >= 6) {
    const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
    if (signature === "GIF87a" || signature === "GIF89a") {
      return true;
    }
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (riff === "RIFF" && webp === "WEBP") {
      return true;
    }
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return true;
  }
  const trimmed = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.length, 256)))
    .trimStart();
  if (trimmed.startsWith("<svg") || trimmed.startsWith("<?xml")) {
    return true;
  }
  return false;
}

export function inferFileContentKind(filePath: string, bytes: Uint8Array): FileContentKind {
  if (isImageFilePath(filePath) || sniffImageFilePath(bytes)) {
    return "image";
  }
  if (isBinaryBytes(bytes)) {
    return "binary";
  }
  return "text";
}

export function isEditableContentKind(contentKind: FileContentKind | undefined): boolean {
  return (contentKind ?? "text") === "text";
}

export function isPreviewContentKind(contentKind: FileContentKind | undefined): boolean {
  return contentKind === "image" || contentKind === "binary";
}
