export interface QuestionPromptChoice {
  label: string;
  selected: boolean;
}

export interface QuestionPromptRequest {
  questionId: string;
  prompt: string;
  choices: string[];
  payload: unknown;
}

export type QuestionPromptResult =
  | { type: "reply"; answers: string[][] }
  | { type: "reject" };

type QuestionPromptRunner = (request: QuestionPromptRequest) => Promise<QuestionPromptResult>;

let runner: QuestionPromptRunner | null = null;

export function registerQuestionPromptRunner(next: QuestionPromptRunner | null): void {
  runner = next;
}

export function promptQuestion(request: QuestionPromptRequest): Promise<QuestionPromptResult> {
  if (!runner) {
    return Promise.resolve({ type: "reject" });
  }
  return runner(request);
}
