import { normalizePathSync } from "./diskFingerprint";
import type { OpencodeFileChangeStatus } from "../ai/backends/workspaceAgentBackend";

/** Aggregate changed descendants without loading closed directories. */
export function projectTreeChangeTones(statuses: ReadonlyMap<string, OpencodeFileChangeStatus> | null): Map<string, "pending" | "conflicted"> {
  const tones = new Map<string, "pending" | "conflicted">();
  for (const [path, status] of statuses ?? []) {
    let key = normalizePathSync(path).replace(/\/+$/, "");
    const tone = status === "conflicted" ? "conflicted" : "pending";
    while (key) {
      if (tones.get(key) !== "conflicted") tones.set(key, tone);
      const slash = key.lastIndexOf("/");
      if (slash < 0) break;
      key = key.slice(0, slash);
    }
  }
  return tones;
}
