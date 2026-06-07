export interface StructuredMessageSection {
  heading: string;
  body: string;
}

const STRUCTURED_HEADING_PATTERN = /^##\s+(.+)\s*$/;

/**
 * Parses assistant output into markdown sections when required headings are present.
 * Section heading matching is case-insensitive.
 */
export function parseStructuredMessageSections(
  content: string,
  requiredSections: readonly string[],
): StructuredMessageSection[] | null {
  const trimmed = content.trim();
  if (!trimmed || requiredSections.length === 0) {
    return null;
  }

  const lines = trimmed.split("\n");
  const sections: StructuredMessageSection[] = [];
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
    const match = line.match(STRUCTURED_HEADING_PATTERN);
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
  const hasKnownSection = requiredSections.some((heading) =>
    normalizedHeadings.has(heading.toLowerCase()),
  );
  return hasKnownSection ? sections : null;
}
