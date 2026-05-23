import { completeOpenPath, requestOpenPath } from "../services/openFileGate";

export async function openAndStoreFile(
  notify: (message: string) => void,
  windowId: string,
  opened: { path: string; content: string; sizeBytes: number } | null,
): Promise<void> {
  if (!opened) {
    return;
  }
  if (opened.sizeBytes > 10 * 1024 * 1024) {
    notify("Open failed: file exceeds 10MB MVP limit.");
    return;
  }

  const gateResult = await requestOpenPath(opened.path, windowId);
  if (gateResult.kind === "redirected") {
    notify(`Switched to ${opened.path} in another window.`);
    return;
  }
  if (gateResult.kind === "existing") {
    notify(`Opened ${opened.path}`);
    return;
  }

  await completeOpenPath(opened.path, opened.content, windowId);
  notify(`Opened ${opened.path}`);
}
