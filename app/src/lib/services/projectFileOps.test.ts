import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canMoveEntry,
  isBlockedProjectTreeDirectory,
  validateEntryName,
} from "./projectFileOps";

describe("validateEntryName", () => {
  it("rejects empty and path separators", () => {
    expect(validateEntryName("")).toBe("Name cannot be empty.");
    expect(validateEntryName("a/b")).toMatch(/separators/);
    expect(validateEntryName("..")).toBe("Invalid name.");
  });

  it("accepts valid names", () => {
    expect(validateEntryName("readme.md")).toBeNull();
  });
});

describe("isBlockedProjectTreeDirectory", () => {
  it("blocks heavy and dot directories", () => {
    expect(isBlockedProjectTreeDirectory("/tmp/ws/node_modules")).toBe(true);
    expect(isBlockedProjectTreeDirectory("/tmp/ws/.git")).toBe(true);
    expect(isBlockedProjectTreeDirectory("/tmp/ws/src")).toBe(false);
  });
});

describe("canMoveEntry", () => {
  const root = "/tmp/ws";

  it("rejects moving folder into itself", () => {
    expect(canMoveEntry(root, "/tmp/ws/src", "/tmp/ws/src/lib")).toMatch(/subfolder/);
  });

  it("rejects same parent", () => {
    expect(canMoveEntry(root, "/tmp/ws/a.txt", "/tmp/ws")).toMatch(/already/);
  });

  it("allows valid move", () => {
    expect(canMoveEntry(root, "/tmp/ws/a.txt", "/tmp/ws/src")).toBeNull();
  });
});
