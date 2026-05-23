import { afterEach, describe, expect, it } from "vitest";
import {
  isMacOs,
  isWindows,
  revealInFileManagerLabel,
} from "./platform";

describe("platform detection", () => {
  let originalNavigator: Navigator | undefined;

  afterEach(() => {
    if (originalNavigator === undefined) {
      delete (globalThis as { navigator?: Navigator }).navigator;
    } else {
      globalThis.navigator = originalNavigator;
    }
    originalNavigator = undefined;
  });

  it("treats missing navigator as non-macOS and non-Windows", () => {
    originalNavigator = globalThis.navigator;
    delete (globalThis as { navigator?: Navigator }).navigator;
    expect(isMacOs()).toBe(false);
    expect(isWindows()).toBe(false);
    expect(revealInFileManagerLabel()).toBe("Show in File Manager");
  });

  it("detects macOS", () => {
    originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { platform: "MacIntel" },
    });
    expect(isMacOs()).toBe(true);
    expect(revealInFileManagerLabel()).toBe("Reveal in Finder");
  });

  it("detects Windows", () => {
    originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { platform: "Win32" },
    });
    expect(isWindows()).toBe(true);
    expect(revealInFileManagerLabel()).toBe("Show in Explorer");
  });

  it("uses generic label on Linux", () => {
    originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { platform: "Linux x86_64" },
    });
    expect(revealInFileManagerLabel()).toBe("Show in File Manager");
  });
});
