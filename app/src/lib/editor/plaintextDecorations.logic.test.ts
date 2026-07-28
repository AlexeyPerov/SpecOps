import { describe, expect, it } from "vitest";
import { codePointAt, codePointSize } from "@codemirror/state";
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

  it("classifies astral emoji as a single decorate-able symbol code point", () => {
    const emoji = "😀";
    expect(emoji.length).toBe(2);
    expect(codePointSize(codePointAt(emoji, 0))).toBe(2);
    expect(shouldDecorateAsSymbol(emoji)).toBe(true);
  });
});
