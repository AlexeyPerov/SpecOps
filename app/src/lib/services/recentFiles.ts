export const RECENT_FILES_LIMIT = 15;

const MACOS_SYSTEM_FOLDERS = new Set([
  "documents",
  "desktop",
  "downloads",
  "pictures",
  "movies",
  "music",
  "public",
]);

const WINDOWS_SYSTEM_FOLDERS = new Set([
  "documents",
  "desktop",
  "downloads",
  "pictures",
  "videos",
  "music",
  "public",
]);

function isWindowsPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /win/i.test(navigator.platform);
}

export function bumpRecentFile(files: string[], filePath: string): string[] {
  return [filePath, ...files.filter((entry) => entry !== filePath)].slice(0, RECENT_FILES_LIMIT);
}

function stripHomePrefix(path: string, homeDir: string): string | null {
  const normalizedPath = path.replaceAll("\\", "/");
  const normalizedHome = homeDir.replaceAll("\\", "/").replace(/\/$/, "");
  const lowerPath = normalizedPath.toLowerCase();
  const lowerHome = normalizedHome.toLowerCase();

  if (lowerPath === lowerHome) {
    return "";
  }
  if (!lowerPath.startsWith(`${lowerHome}/`)) {
    return null;
  }

  return normalizedPath.slice(normalizedHome.length + 1);
}

export function formatRecentPath(path: string, homeDir: string | null): string {
  const normalized = path.replaceAll("\\", "/");
  if (!homeDir) {
    return normalized;
  }

  const relative = stripHomePrefix(normalized, homeDir);
  if (relative === null) {
    return normalized;
  }

  const parts = relative.split("/").filter(Boolean);
  const systemFolders = isWindowsPlatform() ? WINDOWS_SYSTEM_FOLDERS : MACOS_SYSTEM_FOLDERS;
  if (parts.length > 0 && systemFolders.has(parts[0]!.toLowerCase())) {
    parts.shift();
  }

  const tail = parts.join("/");
  return tail ? `~/${tail}` : "~";
}
