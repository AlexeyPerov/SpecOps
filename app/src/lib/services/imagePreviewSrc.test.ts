import { describe, expect, it } from "vitest";
import { mimeTypeForImagePath, withImageVersion } from "./imagePreviewSrc";

describe("mimeTypeForImagePath", () => {
  it("maps common image extensions", () => {
    expect(mimeTypeForImagePath("/tmp/photo.PNG")).toBe("image/png");
    expect(mimeTypeForImagePath("/tmp/icon.svg")).toBe("image/svg+xml");
    expect(mimeTypeForImagePath("/tmp/photo.jpeg")).toBe("image/jpeg");
  });
});

describe("withImageVersion", () => {
  it("leaves the URL alone without a version", () => {
    expect(withImageVersion("http://asset.localhost/%2Ftmp%2Fa.png", "")).toBe(
      "http://asset.localhost/%2Ftmp%2Fa.png",
    );
  });

  it("appends the version as a query parameter", () => {
    expect(withImageVersion("http://asset.localhost/%2Ftmp%2Fa.png", "2000-20")).toBe(
      "http://asset.localhost/%2Ftmp%2Fa.png?v=2000-20",
    );
    expect(withImageVersion("asset://localhost/a.png?x=1", "3")).toBe(
      "asset://localhost/a.png?x=1&v=3",
    );
  });
});
