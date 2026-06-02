import { describe, expect, it } from "vitest";
import {
  getErrorMessage,
  sanitizeErrorDetails,
  sanitizePermissionNoise,
  serializeUnknownError,
  summarizeError,
} from "./commandErrors";

describe("sanitizePermissionNoise", () => {
  it("strips Tauri permission suffix", () => {
    const input =
      "fs.read not allowed Permissions associated with this command: fs.read";
    expect(sanitizePermissionNoise(input)).toBe("fs.read not allowed");
  });

  it("returns the original string when no suffix is present", () => {
    expect(sanitizePermissionNoise("plain error")).toBe("plain error");
  });
});

describe("getErrorMessage", () => {
  it("returns Error.message", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("uses default fallback for unknown values", () => {
    expect(getErrorMessage(42)).toBe("unknown error");
    expect(getErrorMessage("bad things")).toBe("unknown error");
  });

  it("uses custom fallback when provided", () => {
    expect(getErrorMessage(42, String(42))).toBe("42");
  });
});

describe("summarizeError", () => {
  it("summarizes Error instances", () => {
    expect(summarizeError(new Error("boom"))).toBe("boom");
  });

  it("summarizes string errors", () => {
    expect(summarizeError("bad things")).toBe("bad things");
  });

  it("falls back for unknown values", () => {
    expect(summarizeError(42)).toBe("Unknown command error");
  });
});

describe("serializeUnknownError", () => {
  it("serializes Error objects", () => {
    const error = new Error("failed");
    expect(serializeUnknownError(error)).toMatchObject({
      type: "Error",
      message: "failed",
    });
  });

  it("serializes non-error values", () => {
    expect(serializeUnknownError("oops")).toMatchObject({
      type: "string",
      value: "oops",
    });
  });
});

describe("sanitizeErrorDetails", () => {
  it("sanitizes message and value fields and drops json", () => {
    const details = sanitizeErrorDetails({
      message: "denied Permissions associated with this command: x",
      value: "denied Permissions associated with this command: x",
      json: '{"ignored":true}',
    });

    expect(details.message).toBe("denied");
    expect(details.value).toBe("denied");
    expect(details).not.toHaveProperty("json");
  });
});
