import { afterEach, describe, expect, it, vi } from "vitest";
import {
  promptQuestion,
  registerQuestionPromptRunner,
  type QuestionPromptResult,
} from "./questionPrompt";

function mockRunner(
  result: QuestionPromptResult,
): (request: { questionId: string; prompt: string; choices: string[]; payload: unknown }) => Promise<QuestionPromptResult> {
  return vi.fn().mockResolvedValue(result);
}

describe("questionPrompt", () => {
  afterEach(() => {
    registerQuestionPromptRunner(null);
  });

  it("rejects by default when no runner is registered", async () => {
    const result = await promptQuestion({
      questionId: "q-1",
      prompt: "Which framework?",
      choices: ["React", "Svelte"],
      payload: null,
    });
    expect(result).toEqual({ type: "reject" });
  });

  it("delegates to the registered runner", async () => {
    const runner = mockRunner({ type: "reply", answers: [["React"]] });
    registerQuestionPromptRunner(runner);

    const result = await promptQuestion({
      questionId: "q-2",
      prompt: "Pick one",
      choices: ["A", "B"],
      payload: { context: "test" },
    });

    expect(result).toEqual({ type: "reply", answers: [["React"]] });
    expect(runner).toHaveBeenCalledWith({
      questionId: "q-2",
      prompt: "Pick one",
      choices: ["A", "B"],
      payload: { context: "test" },
    });
  });

  it("unregistering the runner causes prompts to reject by default", async () => {
    const runner = mockRunner({ type: "reply", answers: [["X"]] });
    registerQuestionPromptRunner(runner);

    const result1 = await promptQuestion({
      questionId: "q-3",
      prompt: "Before unregister",
      choices: [],
      payload: null,
    });
    expect(result1).toEqual({ type: "reply", answers: [["X"]] });

    registerQuestionPromptRunner(null);

    const result2 = await promptQuestion({
      questionId: "q-4",
      prompt: "After unregister",
      choices: [],
      payload: null,
    });
    expect(result2).toEqual({ type: "reject" });
  });

  it("supports registering a new runner replacing the old one", async () => {
    const runner1 = mockRunner({ type: "reply", answers: [["A"]] });
    const runner2 = mockRunner({ type: "reply", answers: [["B"]] });
    registerQuestionPromptRunner(runner1);

    const result1 = await promptQuestion({
      questionId: "q-5",
      prompt: "First runner",
      choices: ["A"],
      payload: null,
    });
    expect(result1).toEqual({ type: "reply", answers: [["A"]] });
    expect(runner1).toHaveBeenCalledTimes(1);

    registerQuestionPromptRunner(runner2);

    const result2 = await promptQuestion({
      questionId: "q-6",
      prompt: "Second runner",
      choices: ["B"],
      payload: null,
    });
    expect(result2).toEqual({ type: "reply", answers: [["B"]] });
    expect(runner2).toHaveBeenCalledTimes(1);
  });
});
