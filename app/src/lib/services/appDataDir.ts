import { mkdir } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

let ready: Promise<string> | null = null;

/** Ensures `appDataDir()/spec-ops` exists; returns that directory path. */
export function ensureSpecOpsDataDir(): Promise<string> {
  if (!ready) {
    ready = (async () => {
      const base = await appDataDir();
      const dir = await join(base, "spec-ops");
      await mkdir(dir, { recursive: true });
      return dir;
    })();
  }
  return ready;
}
