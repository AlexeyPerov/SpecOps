/** Shared helpers for Vitest suites. Mock Tauri APIs per test file via vi.mock(). */

export function mockNavigatorPlatform(platform: string): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator, "platform");
  Object.defineProperty(globalThis.navigator, "platform", {
    configurable: true,
    value: platform,
  });
  return () => {
    if (original) {
      Object.defineProperty(globalThis.navigator, "platform", original);
    } else {
      delete (globalThis.navigator as { platform?: string }).platform;
    }
  };
}

export function keyboardEvent(partial: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): KeyboardEvent {
  return {
    key: partial.key,
    metaKey: partial.metaKey ?? false,
    ctrlKey: partial.ctrlKey ?? false,
    shiftKey: partial.shiftKey ?? false,
    altKey: partial.altKey ?? false,
    length: partial.key.length,
  } as unknown as KeyboardEvent;
}
