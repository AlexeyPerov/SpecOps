import { describe, expect, it } from "vitest";
import { parseStructuredMessageSections } from "./chatReviewContent";

describe("parseStructuredMessageSections", () => {
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

    const sections = parseStructuredMessageSections(content, [
      "Summary",
      "Critique",
      "Risk / effort estimate",
      "Open questions",
    ]);
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

  it("matches required headings case-insensitively", () => {
    const content = ["## SUMMARY", "High level takeaway.", "", "## OPEN QUESTIONS", "- What next?"].join(
      "\n",
    );
    const sections = parseStructuredMessageSections(content, ["Summary", "Open questions"]);
    expect(sections).toEqual([
      { heading: "SUMMARY", body: "High level takeaway." },
      { heading: "OPEN QUESTIONS", body: "- What next?" },
    ]);
  });

  it("returns null for conversational text and missing required headings", () => {
    expect(parseStructuredMessageSections("Plain conversational answer.", ["Summary"])).toBeNull();
    expect(parseStructuredMessageSections("## Notes\nNo known sections here.", ["Summary"])).toBeNull();
  });

  it("returns null when required sections are empty", () => {
    expect(parseStructuredMessageSections("## Summary\nSomething", [])).toBeNull();
  });
});
