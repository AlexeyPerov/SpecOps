import { REVIEW_REQUIRED_SECTIONS } from "./modes/builtins";

export interface ReviewMessageSection {
  heading: string;
  body: string;
}

const REVIEW_HEADING_PATTERN = /^##\s+(.+)\s*$/;

/** Parses assistant review output into sections when markdown headings are present. */
export function parseReviewMessageSections(content: string): ReviewMessageSection[] | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed.split("\n");
  const sections: ReviewMessageSection[] = [];
  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  function flushSection(): void {
    if (!currentHeading) {
      return;
    }
    sections.push({
      heading: currentHeading,
      body: currentBody.join("\n").trim(),
    });
    currentBody = [];
  }

  for (const line of lines) {
    const match = line.match(REVIEW_HEADING_PATTERN);
    if (match) {
      flushSection();
      currentHeading = match[1].trim();
      continue;
    }
    if (currentHeading) {
      currentBody.push(line);
    }
  }

  flushSection();
  if (sections.length === 0) {
    return null;
  }

  const normalizedHeadings = new Set(sections.map((section) => section.heading.toLowerCase()));
  const hasKnownSection = REVIEW_REQUIRED_SECTIONS.some((heading) =>
    normalizedHeadings.has(heading.toLowerCase()),
  );
  return hasKnownSection ? sections : null;
}
