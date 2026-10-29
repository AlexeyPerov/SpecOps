import { derived, writable, type Readable } from "svelte/store";

/**
 * Per-session queue for agent interaction requests (permission approvals,
 * questions) that are answered inline in the owning session's chat.
 *
 * Each workspace session holds at most one pending request per queue: a new
 * request for the same session supersedes the previous one, which resolves
 * with the queue's `rejected` value. Requests stay pending until they are
 * answered, superseded, or their `signal` aborts — they are never rejected
 * just because no chat for that session is currently mounted, so the card
 * shows up as soon as the session's chat is opened.
 */
export interface SessionPromptTarget {
  sessionId: string;
  /** Workspace root (chat scope key) that owns the session. */
  root?: string | null;
  signal?: AbortSignal;
}

export interface SessionPromptEntry<Request> {
  /** Stable key of the owning session (`sessionPromptKey(root, sessionId)`). */
  key: string;
  /** Monotonic id of this request; answers must name it to be accepted. */
  seq: number;
  sessionId: string;
  root: string | null;
  request: Request;
}

export interface SessionPromptQueue<Request extends SessionPromptTarget, Result>
  extends Readable<Readonly<Record<string, SessionPromptEntry<Request>>>> {
  /** Queue a request for its session and wait for an answer. */
  request(request: Request): Promise<Result>;
  /** Answer a pending entry. Returns false when the entry is no longer pending. */
  respond(entry: Pick<SessionPromptEntry<Request>, "key" | "seq">, result: Result): boolean;
  /** Pending entry for one session (null when none). */
  forSession(root: string | null | undefined, sessionId: string | null | undefined): Readable<SessionPromptEntry<Request> | null>;
  /** Resolve every pending entry with the rejected value (test isolation). */
  rejectAll(): void;
}

export function sessionPromptKey(root: string | null | undefined, sessionId: string): string {
  return `${root ?? ""}\u0000${sessionId}`;
}

let nextSeq = 0;

export function createSessionPromptQueue<Request extends SessionPromptTarget, Result>(
  rejected: Result,
): SessionPromptQueue<Request, Result> {
  const entries = writable<Record<string, SessionPromptEntry<Request>>>({});
  const settlers = new Map<string, { seq: number; finish: (result: Result) => void }>();

  function remove(key: string, seq: number): void {
    entries.update((current) => {
      if (current[key]?.seq !== seq) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function request(input: Request): Promise<Result> {
    if (input.signal?.aborted) return Promise.resolve(rejected);
    const key = sessionPromptKey(input.root, input.sessionId);
    settlers.get(key)?.finish(rejected);
    const seq = ++nextSeq;
    return new Promise<Result>((resolve) => {
      let settled = false;
      const abort = () => finish(rejected);
      const finish = (result: Result) => {
        if (settled) return;
        settled = true;
        input.signal?.removeEventListener("abort", abort);
        if (settlers.get(key)?.seq === seq) settlers.delete(key);
        remove(key, seq);
        resolve(result);
      };
      settlers.set(key, { seq, finish });
      input.signal?.addEventListener("abort", abort, { once: true });
      entries.update((current) => ({
        ...current,
        [key]: { key, seq, sessionId: input.sessionId, root: input.root ?? null, request: input },
      }));
    });
  }

  function respond(entry: Pick<SessionPromptEntry<Request>, "key" | "seq">, result: Result): boolean {
    const settler = settlers.get(entry.key);
    if (!settler || settler.seq !== entry.seq) return false;
    settler.finish(result);
    return true;
  }

  function forSession(root: string | null | undefined, sessionId: string | null | undefined) {
    const key = sessionId ? sessionPromptKey(root, sessionId) : null;
    return derived(entries, (current) => (key ? current[key] ?? null : null));
  }

  function rejectAll(): void {
    for (const settler of [...settlers.values()]) settler.finish(rejected);
  }

  return { subscribe: entries.subscribe, request, respond, forSession, rejectAll };
}
