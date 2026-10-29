/** MIME type for `<img src>` when loading image bytes via blob URL fallback. */
export function mimeTypeForImagePath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (lower.endsWith(".ico")) {
    return "image/x-icon";
  }
  if (lower.endsWith(".bmp")) {
    return "image/bmp";
  }
  if (lower.endsWith(".avif")) {
    return "image/avif";
  }
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) {
    return "image/heic";
  }
  return "application/octet-stream";
}

/**
 * Appends a cache-busting `v` query to an asset URL. The asset protocol serves
 * files by path and ignores the query, so only the webview cache sees it.
 */
export function withImageVersion(src: string, version: string): string {
  if (!version) {
    return src;
  }
  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}v=${encodeURIComponent(version)}`;
}
