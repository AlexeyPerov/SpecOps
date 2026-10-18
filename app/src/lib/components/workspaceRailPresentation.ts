export const PROJECT_COLORS = [
  { value: "#65a3ff", label: "Blue" },
  { value: "#a78bfa", label: "Purple" },
  { value: "#e879b4", label: "Pink" },
  { value: "#e9a24b", label: "Orange" },
  { value: "#65b98a", label: "Green" },
  { value: "#58bfc5", label: "Teal" },
] as const;
export const PROJECT_ICONS = ["◆", "●", "▲", "★", "✦", "⬡"] as const;

export function projectColor(value?: string): string | undefined {
  return PROJECT_COLORS.find((color) => color.value === value)?.value;
}
export function projectIcon(value?: string): string | undefined {
  return PROJECT_ICONS.find((icon) => icon === value);
}
export function projectName(root: string): string {
  return root.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || root;
}

/** The shortest parent suffix that distinguishes projects sharing a name. */
export function distinguishingProjectPaths(
  projects: ReadonlyArray<{ id: string; rootPath: string; name: string }>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const project of projects) {
    const peers = projects.filter((other) => other.name.toLocaleLowerCase() === project.name.toLocaleLowerCase());
    if (peers.length < 2) continue;
    const parts = project.rootPath.replaceAll("\\", "/").split("/").filter(Boolean).slice(0, -1);
    let suffix = project.rootPath;
    for (let length = 1; length <= parts.length; length++) {
      const candidate = parts.slice(-length).join("/");
      if (peers.every((other) => other.id === project.id ||
        other.rootPath.replaceAll("\\", "/").split("/").filter(Boolean).slice(0, -1).slice(-length).join("/") !== candidate)) {
        suffix = candidate;
        break;
      }
    }
    result.set(project.id, suffix);
  }
  return result;
}
