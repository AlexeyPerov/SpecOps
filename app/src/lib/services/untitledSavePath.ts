import { join } from "@tauri-apps/api/path";
import { deriveUntitledFilename } from "./untitledTitle";

export async function untitledSaveDefaultPath(
  content: string,
  workspaceRoot: string | null,
): Promise<string | undefined> {
  if (!workspaceRoot) {
    return undefined;
  }
  return join(workspaceRoot, deriveUntitledFilename(content));
}
