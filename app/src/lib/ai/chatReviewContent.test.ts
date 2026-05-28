import { describe, expect, it } from "vitest";
import { parseReviewMessageSections } from "./chatReviewContent";

describe("parseReviewMessageSections", () => {
  it("parses review headings into sections for structured rendering", () => {
    const content = [
      "## Summary",
      "A long summary about the proposal with enough detail to wrap across multiple lines in a narrow agent tab layout.",
      "",
      "## Critique",
      "- Assumption one needs validation",
      "- Assumption two is under-specified",
      "",
      "## Risk / effort estimate",
      "T-shirt size: L · Confidence: medium",
      "",
      "## Open questions",
      "- What is the rollout plan?",
    ].join("\n");

    const sections = parseReviewMessageSections(content);
    expect(sections).toEqual([
      {
        heading: "Summary",
        body: "A long summary about the proposal with enough detail to wrap across multiple lines in a narrow agent tab layout.",
      },
      {
        heading: "Critique",
        body: "- Assumption one needs validation\n- Assumption two is under-specified",
      },
      {
        heading: "Risk / effort estimate",
        body: "T-shirt size: L · Confidence: medium",
      },
      {
        heading: "Open questions",
        body: "- What is the rollout plan?",
      },
    ]);
  });

  it("returns null for non-review assistant text", () => {
    expect(parseReviewMessageSections("Plain conversational answer.")).toBeNull();
    expect(parseReviewMessageSections("## Notes\nNo known review sections here.")).toBeNull();
  });
});
