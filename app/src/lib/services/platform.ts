export function isMacOs(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /mac/i.test(navigator.platform);
}

export function isWindows(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /win/i.test(navigator.platform);
}

export function revealInFileManagerLabel(): string {
  if (isMacOs()) {
    return "Reveal in Finder";
  }
  if (isWindows()) {
    return "Show in Explorer";
  }
  return "Show in File Manager";
}
