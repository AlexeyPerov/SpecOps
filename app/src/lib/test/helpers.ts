/** Shared helpers for Vitest suites. Mock Tauri APIs per test file via vi.mock(). */

export function mockNavigatorPlatform(platform: string): () => void {
  const nav = globalThis.navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const originalPlatform = Object.getOwnPropertyDescriptor(nav, "platform");
  const originalUserAgent = Object.getOwnPropertyDescriptor(nav, "userAgent");
  const originalUserAgentData = Object.getOwnPropertyDescriptor(nav, "userAgentData");
  Object.defineProperty(nav, "platform", {
    configurable: true,
    value: platform,
  });
  Object.defineProperty(nav, "userAgent", {
    configurable: true,
    value: `Mozilla/5.0 (${platform}) SpecOpsTest/1.0`,
  });
  Object.defineProperty(nav, "userAgentData", {
    configurable: true,
    value: { platform },
  });
  return () => {
    if (originalPlatform) {
      Object.defineProperty(nav, "platform", originalPlatform);
    } else {
      delete (nav as { platform?: string }).platform;
    }
    if (originalUserAgent) {
      Object.defineProperty(nav, "userAgent", originalUserAgent);
    } else {
      delete (nav as { userAgent?: string }).userAgent;
    }
    if (originalUserAgentData) {
      Object.defineProperty(nav, "userAgentData", originalUserAgentData);
    } else {
      delete (nav as { userAgentData?: { platform?: string } }).userAgentData;
    }
  };
}

export function keyboardEvent(partial: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
}): KeyboardEvent {
  return {
    key: partial.key,
    metaKey: partial.metaKey ?? false,
    ctrlKey: partial.ctrlKey ?? false,
    shiftKey: partial.shiftKey ?? false,
    altKey: partial.altKey ?? false,
    target: partial.target ?? null,
    length: partial.key.length,
  } as unknown as KeyboardEvent;
}
