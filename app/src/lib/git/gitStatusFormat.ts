/** Short label for a porcelain status code shown in the Changes panel. */
export function formatWorkingTreeStatusCode(statusCode: string): string {
  const trimmed = statusCode.trim();
  if (trimmed === "??") {
    return "Untracked";
  }
  if (trimmed.includes("M")) {
    return "Modified";
  }
  if (trimmed.includes("A")) {
    return "Added";
  }
  if (trimmed.includes("D")) {
    return "Deleted";
  }
  if (trimmed.includes("R")) {
    return "Renamed";
  }
  if (trimmed.includes("C")) {
    return "Copied";
  }
  if (trimmed.includes("U")) {
    return "Unmerged";
  }
  return trimmed || "Changed";
}
