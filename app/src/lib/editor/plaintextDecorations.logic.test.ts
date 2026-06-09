import { describe, expect, it } from "vitest";
import { shouldDecorateAsSymbol } from "./plaintextDecorations";

describe("shouldDecorateAsSymbol", () => {
  it("does not decorate letters and digits across languages", () => {
    expect(shouldDecorateAsSymbol("a")).toBe(false);
    expect(shouldDecorateAsSymbol("Я")).toBe(false);
    expect(shouldDecorateAsSymbol("你")).toBe(false);
    expect(shouldDecorateAsSymbol("9")).toBe(false);
    expect(shouldDecorateAsSymbol(" ")).toBe(false);
  });

  it("decorates punctuation and symbols", () => {
    expect(shouldDecorateAsSymbol("+")).toBe(true);
    expect(shouldDecorateAsSymbol("=")).toBe(true);
    expect(shouldDecorateAsSymbol("!")).toBe(true);
    expect(shouldDecorateAsSymbol("#")).toBe(true);
  });
});
