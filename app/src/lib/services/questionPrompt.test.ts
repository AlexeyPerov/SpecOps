import { afterEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import {
  answerQuestionPrompt,
  pendingQuestionPrompts,
  promptQuestion,
} from "./questionPrompt";

const ROOT = "/work/question";

describe("questionPrompt", () => {
  afterEach(() => {
    pendingQuestionPrompts.rejectAll();
  });

  it("queues the question for its session and resolves with the answer", async () => {
    const pending = promptQuestion({
      sessionId: "session-1",
      root: ROOT,
      questionId: "q-1",
      prompt: "Which?",
      choices: ["A", "B"],
      payload: { multiSelect: false },
    });
    const entry = get(pendingQuestionPrompts.forSession(ROOT, "session-1"))!;
    expect(entry.request).toMatchObject({ questionId: "q-1", prompt: "Which?", choices: ["A", "B"] });
    expect(get(pendingQuestionPrompts.forSession(ROOT, "session-2"))).toBeNull();

    answerQuestionPrompt(entry, { type: "reply", answers: [["B"]] });
    await expect(pending).resolves.toEqual({ type: "reply", answers: [["B"]] });
    expect(get(pendingQuestionPrompts)).toEqual({});
  });

  it("rejects when the signal aborts", async () => {
    const controller = new AbortController();
    const pending = promptQuestion({ sessionId: "s", root: ROOT, questionId: "q-2", prompt: "?", choices: [], payload: {}, signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toEqual({ type: "reject" });
    expect(get(pendingQuestionPrompts)).toEqual({});
  });

  it("a newer question for the same session supersedes the pending one", async () => {
    const first = promptQuestion({ sessionId: "s", root: ROOT, questionId: "q-3", prompt: "First", choices: [], payload: {} });
    const second = promptQuestion({ sessionId: "s", root: ROOT, questionId: "q-4", prompt: "Second", choices: [], payload: {} });
    await expect(first).resolves.toEqual({ type: "reject" });
    const entry = get(pendingQuestionPrompts.forSession(ROOT, "s"))!;
    expect(entry.request.prompt).toBe("Second");
    answerQuestionPrompt(entry, { type: "reply", answers: [["ok"]] });
    await expect(second).resolves.toEqual({ type: "reply", answers: [["ok"]] });
  });
});
