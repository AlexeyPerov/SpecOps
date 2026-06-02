import { describe, expect, it } from "vitest";
import { mimeTypeForImagePath } from "./imagePreviewSrc";

describe("mimeTypeForImagePath", () => {
  it("maps common image extensions", () => {
    expect(mimeTypeForImagePath("/tmp/photo.PNG")).toBe("image/png");
    expect(mimeTypeForImagePath("/tmp/icon.svg")).toBe("image/svg+xml");
    expect(mimeTypeForImagePath("/tmp/photo.jpeg")).toBe("image/jpeg");
  });
});
