export interface QuestionPromptChoice {
  label: string;
  selected: boolean;
}

export interface QuestionPromptRequest {
  questionId: string;
  prompt: string;
  choices: string[];
  payload: unknown;
  signal?: AbortSignal;
}

export type QuestionPromptResult =
  | { type: "reply"; answers: string[][] }
  | { type: "reject" };

type QuestionPromptRunner = (request: QuestionPromptRequest) => Promise<QuestionPromptResult>;

let runner: QuestionPromptRunner | null = null;
const pending = new Map<string, { request: QuestionPromptRequest; deliver: () => void }>();

export function registerQuestionPromptRunner(next: QuestionPromptRunner | null): void {
  runner = next;
  if (next) for (const entry of pending.values()) entry.deliver();
}

export function promptQuestion(request: QuestionPromptRequest): Promise<QuestionPromptResult> {
  if (!runner) {
    return Promise.resolve({ type: "reject" });
  }
  if (request.signal?.aborted) return Promise.resolve({ type: "reject" });
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: QuestionPromptResult) => { if (settled) return; settled = true; pending.delete(request.questionId); request.signal?.removeEventListener('abort', abort); resolve(value); };
    const abort = () => finish({ type: "reject" });
    const deliver = () => { if (runner && !settled) void runner(request).then(finish, abort); };
    pending.set(request.questionId, { request, deliver });
    request.signal?.addEventListener('abort', abort, { once: true });
    deliver();
  });
}
