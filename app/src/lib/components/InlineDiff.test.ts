import { describe, expect, it, vi } from "vitest";
import type { MessageDiff } from "../ai/chatDiffs";
import InlineDiff from "./InlineDiff.svelte";
import { mountComponent } from "./_testComponentMount";

function diff(overrides: Partial<MessageDiff> = {}): MessageDiff {
  return {
    id: "d-1",
    snapshot: "0123456789abcdef0123456789abcdef01234567",
    ...overrides,
  };
}

describe("InlineDiff.svelte", () => {
  it("renders the checkpoint label and short hash when a snapshot is present", () => {
    const { host } = mountComponent(InlineDiff, {
      diff: diff({ snapshot: "0123456789abcdef0123456789abcdef01234567" }),
      expanded: false,
    });
    expect(host.querySelector(".inline-diff-kind")?.textContent).toContain("Checkpoint");
    // Long git-style hash truncated to 7 chars.
    expect(host.querySelector(".inline-diff-hash")?.textContent).toBe("0123456");
  });

  it("renders the full hash when it is already short", () => {
    const { host } = mountComponent(InlineDiff, {
      diff: diff({ snapshot: "abc123" }),
      expanded: false,
    });
    expect(host.querySelector(".inline-diff-hash")?.textContent).toBe("abc123");
  });

  it("renders a 'Changed files' label instead of a checkpoint when there is no snapshot", () => {
    const { host } = mountComponent(InlineDiff, {
      diff: diff({ snapshot: undefined, files: ["src/a.ts"] }),
      expanded: false,
    });
    expect(host.querySelector(".inline-diff-kind")?.textContent).toContain("Changed files");
    expect(host.querySelector(".inline-diff-hash")).toBeNull();
  });

  it("disables the header and omits the chevron when there are no files to expand", () => {
    const { host } = mountComponent(InlineDiff, {
      diff: diff({ files: undefined }),
      expanded: false,
    });
    const header = host.querySelector<HTMLButtonElement>(".inline-diff-header");
    expect(header?.disabled).toBe(true);
    expect(host.querySelector(".inline-diff-chevron")).toBeNull();
    expect(host.querySelector(".inline-diff-files")).toBeNull();
  });

  it("shows the file count in the header and lists files when expanded", () => {
    const { host } = mountComponent(InlineDiff, {
      diff: diff({ files: ["src/index.ts", "src/util.ts"] }),
      expanded: true,
    });
    expect(host.querySelector(".inline-diff-count")?.textContent).toContain("2");
    expect(host.querySelector(".inline-diff-count")?.textContent).toContain("files");
    const files = Array.from(host.querySelectorAll(".inline-diff-file-path")).map(
      (el) => el.textContent,
    );
    expect(files).toEqual(["src/index.ts", "src/util.ts"]);
  });

  it("uses the singular 'file' for a single changed file", () => {
    const { host } = mountComponent(InlineDiff, {
      diff: diff({ files: ["only.ts"] }),
      expanded: false,
    });
    const text = host.querySelector(".inline-diff-count")?.textContent ?? "";
    expect(text).toContain("1");
    expect(text).toContain("file");
    expect(text).not.toContain("files");
  });

  it("invokes onToggle when an enabled header is clicked", () => {
    const onToggle = vi.fn();
    const { host } = mountComponent(InlineDiff, {
      diff: diff({ files: ["a.ts"] }),
      expanded: false,
      onToggle,
    });
    host.querySelector<HTMLButtonElement>(".inline-diff-header")?.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onToggle when the disabled header is clicked", () => {
    const onToggle = vi.fn();
    const { host } = mountComponent(InlineDiff, {
      diff: diff({ files: undefined }),
      expanded: false,
      onToggle,
    });
    host.querySelector<HTMLButtonElement>(".inline-diff-header")?.click();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("flips the chevron and aria-expanded between collapsed and expanded when files exist", () => {
    const collapsed = mountComponent(InlineDiff, {
      diff: diff({ files: ["a.ts"] }),
      expanded: false,
    });
    expect(collapsed.host.querySelector(".inline-diff-chevron")?.textContent).toBe("▸");
    expect(
      collapsed.host.querySelector<HTMLButtonElement>(".inline-diff-header")?.getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");
    collapsed.unmount();

    const expanded = mountComponent(InlineDiff, {
      diff: diff({ files: ["a.ts"] }),
      expanded: true,
    });
    expect(expanded.host.querySelector(".inline-diff-chevron")?.textContent).toBe("▾");
    expect(
      expanded.host.querySelector<HTMLButtonElement>(".inline-diff-header")?.getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
  });
});
