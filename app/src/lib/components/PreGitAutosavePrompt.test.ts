import { describe, expect, it } from "vitest";
import { flushSync } from "svelte";
import PreGitAutosavePrompt from "./PreGitAutosavePrompt.svelte";
import { mountComponent } from "./_testComponentMount";
import { promptPreGitAutosaveFailures } from "../services/preGitAutosavePrompt";

describe("PreGitAutosavePrompt", () => {
  it("lists failures that share a file name and still resolves the choice", async () => {
    const view = mountComponent(PreGitAutosavePrompt, {});
    flushSync();
    const choice = promptPreGitAutosaveFailures({
      failures: [
        { documentId: "1", title: "README.md", filePath: "/repo/a/README.md", message: "denied" },
        { documentId: "2", title: "README.md", filePath: "/repo/b/README.md", message: "denied" },
      ],
    });
    flushSync();
    const items = Array.from(view.host.querySelectorAll(".pre-git-autosave-prompt-list li"));
    expect(items.map((item) => item.textContent)).toEqual(["README.md", "README.md"]);

    Array.from(view.host.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Continue anyway")!
      .click();
    await expect(choice).resolves.toEqual({ type: "continue-anyway" });
  });
});
