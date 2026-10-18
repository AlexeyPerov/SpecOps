import { describe, expect, it } from "vitest";
import { distinguishingProjectPaths, projectName, projectColor, projectIcon } from "./workspaceRailPresentation";
describe("workspace rail presentation", () => {
  it("uses the shortest unique parent suffix for equal project names", () => {
    const rows = ["/clients/one/app", "/personal/one/app", "/clients/two/app", "/clients/unique"]
      .map((rootPath, index) => ({ id: String(index), rootPath, name: projectName(rootPath) }));
    expect([...distinguishingProjectPaths(rows)]).toEqual([["0", "clients/one"], ["1", "personal/one"], ["2", "two"]]);
  });
  it("supports Windows and trailing separators and safely validates appearance", () => {
    expect(projectName("C:\\work\\Project\\")).toBe("Project");
    expect(projectColor("#65a3ff")).toBe("#65a3ff");
    expect(projectColor("red;display:none")).toBeUndefined();
    expect(projectIcon("★")).toBe("★");
    expect(projectIcon("long project name")).toBeUndefined();
  });
});
