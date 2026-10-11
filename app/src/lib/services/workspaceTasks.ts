export interface WorkspaceTask { line: number; text: string; checked: boolean }
export function parseWorkspaceTasks(content: string): WorkspaceTask[] {
  const result: WorkspaceTask[] = [];
  let fence: { character: string; length: number } | null = null;
  content.split("\n").forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length && /^\s*$/.test(line.slice(marker[0].length))) fence = null;
      return;
    }
    if (fence) return;
    const match = /^[-*+] \[([ xX])\] (.*?)(?:\r)?$/.exec(line);
    if (match) result.push({ line: index, text: match[2], checked: match[1] !== " " });
  });
  return result;
}
export function updateWorkspaceTask(content: string, line: number, text?: string, checked?: boolean): string {
  const task = parseWorkspaceTasks(content).find((task) => task.line === line);
  if (!task) return content;
  const lines = content.split("\n");
  const original = lines[line];
  lines[line] = `${original[0]} [${(checked ?? task.checked) ? "x" : " "}] ${text ?? task.text}${original.endsWith("\r") ? "\r" : ""}`;
  return lines.join("\n");
}
export function reorderWorkspaceTask(content: string, line: number, direction: -1 | 1): string {
  const tasks = parseWorkspaceTasks(content); const index = tasks.findIndex((task) => task.line === line);
  const neighbor = tasks[index + direction];
  if (index < 0 || !neighbor) return content;
  const lines = content.split("\n");
  [lines[line], lines[neighbor.line]] = [lines[neighbor.line], lines[line]];
  return lines.join("\n");
}
export function appendWorkspaceTask(content: string, text: string): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  return `${content}${content.endsWith("\n") || !content ? "" : newline}- [ ] ${text.replace(/[\r\n]/g, " ").trim()}${newline}`;
}
