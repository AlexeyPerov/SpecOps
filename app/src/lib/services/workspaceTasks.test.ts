import { describe, expect, it } from "vitest";
import { parseWorkspaceTasks, updateWorkspaceTask, reorderWorkspaceTask, appendWorkspaceTask } from "./workspaceTasks";
describe("workspace task Markdown", () => {
  it("ignores fenced examples and keeps prose, indentation and CRLF intact", () => {
    const source = "# Tasks\r\n\r\n- [ ] First\r\n```md\r\n- [ ] Example\r\n```\r\n  - [ ] Nested\r\n- [X] Last\r\n";
    expect(parseWorkspaceTasks(source)).toEqual([{ line: 2, text: "First", checked: false }, { line: 7, text: "Last", checked: true }]);
    expect(updateWorkspaceTask(source, 2, undefined, true)).toBe(source.replace("- [ ] First", "- [x] First"));
    expect(reorderWorkspaceTask(source, 7, -1)).toBe(source.replace("- [ ] First", "- [X] Last").replace(/- \[X\] Last(?=\r\n$)/, "- [ ] First"));
  });
  it("appends one plain task without injecting extra Markdown rows", () => {
    expect(appendWorkspaceTask("# Tasks", "one\ntwo")).toBe("# Tasks\n- [ ] one two\n");
  });
});
