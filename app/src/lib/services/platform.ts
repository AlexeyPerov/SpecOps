function navigatorPlatformString(): string {
  if (typeof navigator === "undefined") {
    return "";
  }
  // Prefer userAgentData when present; fall back to platform, then userAgent.
  // (`navigator.platform` is deprecated but still the most direct signal in
  // test doubles and older webviews that blank userAgentData.)
  const uaData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  if (uaData?.platform) {
    return uaData.platform;
  }
  if (navigator.platform) {
    return navigator.platform;
  }
  return navigator.userAgent ?? "";
}

export function isMacOs(): boolean {
  const platform = navigatorPlatformString();
  // iPadOS may report Mac-like tokens; exclude the "like Mac" Android/iPhone forms.
  return /mac/i.test(platform) && !/like mac/i.test(platform);
}

export function isWindows(): boolean {
  return /win/i.test(navigatorPlatformString());
}

/** True when the default filesystem treats paths as case-insensitive. */
export function isCaseInsensitivePathPlatform(): boolean {
  return isMacOs() || isWindows();
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
