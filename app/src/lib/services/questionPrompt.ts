import {
  createSessionPromptQueue,
  type SessionPromptEntry,
  type SessionPromptTarget,
} from "./sessionPromptQueue";

export interface QuestionPromptRequest extends SessionPromptTarget {
  questionId: string;
  prompt: string;
  choices: string[];
  payload: unknown;
}

export type QuestionPromptResult =
  | { type: "reply"; answers: string[][] }
  | { type: "reject" };

export type PendingQuestionPrompt = SessionPromptEntry<QuestionPromptRequest>;

/**
 * Pending agent questions keyed by owning session. The session's chat renders
 * the entry as an inline card and answers it through `answerQuestionPrompt`.
 */
export const pendingQuestionPrompts = createSessionPromptQueue<QuestionPromptRequest, QuestionPromptResult>({
  type: "reject",
});

/**
 * Ask the user a question in the requesting session's chat. Resolves with
 * `reject` when the request is aborted or superseded by a newer question for
 * the same session.
 */
export function promptQuestion(request: QuestionPromptRequest): Promise<QuestionPromptResult> {
  return pendingQuestionPrompts.request(request);
}

export function answerQuestionPrompt(entry: Pick<PendingQuestionPrompt, "key" | "seq">, result: QuestionPromptResult): boolean {
  return pendingQuestionPrompts.respond(entry, result);
}
