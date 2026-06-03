export type ProjectTreeLabelTone = "default" | "hidden" | "text";

const TEXT_FILE_EXTENSIONS = [".txt", ".md", ".markdown"] as const;

export function classifyProjectTreeLabelTone(
  name: string,
  kind: "file" | "directory",
): ProjectTreeLabelTone {
  if (name.startsWith(".")) {
    return "hidden";
  }
  if (kind === "directory") {
    return "default";
  }
  const lower = name.toLowerCase();
  for (const extension of TEXT_FILE_EXTENSIONS) {
    if (lower.endsWith(extension)) {
      return "text";
    }
  }
  if (!name.includes(".")) {
    return "text";
  }
  return "default";
}
