import { describe, expect, it } from "vitest";
import GitCommitMetadata from "./GitCommitMetadata.svelte";
import { mountComponent } from "./_testComponentMount";
import type { CommitDetail } from "../git/types";

const detail = (authorTime: number): CommitDetail => ({
  sha: "a".repeat(40),
  parents: [],
  authorName: "Test Author",
  authorEmail: "author@example.test",
  authorTime,
  committerName: "Test Author",
  committerEmail: "author@example.test",
  committerTime: 1700000000,
  message: "Subject",
  files: [],
});

describe("GitCommitMetadata", () => {
  it("renders an out-of-range timestamp without a machine-readable time", () => {
    const view = mountComponent(GitCommitMetadata, { commit: detail(1e13) });
    const times = view.host.querySelectorAll("time");
    expect(times[0]?.hasAttribute("datetime")).toBe(false);
    expect(times[1]?.getAttribute("datetime")).toBe(new Date(1700000000 * 1000).toISOString());
    expect(view.host.textContent).toContain("Test Author");
  });
});
