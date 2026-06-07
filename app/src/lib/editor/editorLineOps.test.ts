import { describe, expect, it } from "vitest";
import {
  duplicateLineText,
  joinLinesText,
  lineRange,
  moveLineDown,
  moveLineUp,
} from "./editorLineOps";

describe("editorLineOps", () => {
  it("computes the line range around a selection", () => {
    const text = "alpha\nbeta\ngamma";
    expect(lineRange(text, 7, 7)).toEqual({ start: 6, end: 10 });
    expect(lineRange(text, 0, 0)).toEqual({ start: 0, end: 5 });
  });

  it("moves the current line up and down", () => {
    const text = "first\nsecond\nthird";
    const movedUp = moveLineUp(text, 8, 8);
    expect(movedUp.text).toBe("second\nfirst\nthird");
    expect(movedUp.message).toBe("Moved line up");

    const movedDown = moveLineDown(movedUp.text, 0, 0);
    expect(movedDown.text).toBe("first\nsecond\nthird");
    expect(movedDown.message).toBe("Moved line down");
  });

  it("refuses to move the first line up or the last line down", () => {
    const text = "only\nline";
    expect(moveLineUp(text, 0, 0)).toMatchObject({ text, message: "Already at first line" });
    expect(moveLineDown(text, 5, 5)).toMatchObject({ text, message: "Already at last line" });
  });

  it("duplicates the current line below itself", () => {
    const text = "alpha\nbeta";
    const result = duplicateLineText(text, 6, 6);
    expect(result.text).toBe("alpha\nbeta\nbeta\n");
    expect(result.message).toBe("Duplicated line");
  });

  it("joins the current line with the next line", () => {
    const text = "alpha\nbeta\ngamma";
    const result = joinLinesText(text, 0, 0);
    expect(result.text).toBe("alpha beta\ngamma");
    expect(result.message).toBe("Joined lines");
    expect(joinLinesText("solo", 0, 0).message).toBe("Nothing to join");
  });
});
