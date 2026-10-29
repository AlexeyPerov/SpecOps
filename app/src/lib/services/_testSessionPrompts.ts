/**
 * Test helpers for the per-session prompt queues: answer pending permission
 * and question requests automatically, the way a user would through the
 * inline cards in the session chat.
 */
import {
  answerPermissionPrompt,
  pendingPermissionPrompts,
  type PermissionPromptRequest,
  type PermissionPromptResult,
} from "./permissionPrompt";
import {
  answerQuestionPrompt,
  pendingQuestionPrompts,
  type QuestionPromptRequest,
  type QuestionPromptResult,
} from "./questionPrompt";
import type { SessionPromptEntry, SessionPromptQueue, SessionPromptTarget } from "./sessionPromptQueue";

type Answer<Request, Result> = (request: Request) => Result | Promise<Result>;

function autoAnswer<Request extends SessionPromptTarget, Result>(
  queue: SessionPromptQueue<Request, Result>,
  respond: (entry: SessionPromptEntry<Request>, result: Result) => boolean,
) {
  let stop: (() => void) | null = null;
  return (answer: Answer<Request, Result> | null): void => {
    stop?.();
    stop = null;
    queue.rejectAll();
    if (!answer) return;
    const handled = new Set<number>();
    stop = queue.subscribe((entries) => {
      for (const entry of Object.values(entries)) {
        if (handled.has(entry.seq)) continue;
        handled.add(entry.seq);
        void Promise.resolve(answer(entry.request)).then((result) => respond(entry, result));
      }
    });
  };
}

/** Answer every permission request with `answer`; `null` stops and rejects pending ones. */
export const setPermissionPromptAutoAnswer: (
  answer: Answer<PermissionPromptRequest, PermissionPromptResult> | null,
) => void = autoAnswer(pendingPermissionPrompts, answerPermissionPrompt);

/** Answer every question with `answer`; `null` stops and rejects pending ones. */
export const setQuestionPromptAutoAnswer: (
  answer: Answer<QuestionPromptRequest, QuestionPromptResult> | null,
) => void = autoAnswer(pendingQuestionPrompts, answerQuestionPrompt);
