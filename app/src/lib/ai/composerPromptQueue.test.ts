import { describe, expect, it } from "vitest";
import {
  createComposerPromptQueue,
  defaultQueueMode,
} from "./composerPromptQueue";

describe("composerPromptQueue", () => {
  it("starts empty", () => {
    const queue = createComposerPromptQueue();
    expect(queue.snapshot().items).toEqual([]);
  });

  it("enqueues a prompt and exposes it in the snapshot", () => {
    const queue = createComposerPromptQueue();
    const entry = queue.enqueue({ prompt: "hello", mode: "queue" });
    expect(entry).not.toBeNull();
    expect(entry!.prompt).toBe("hello");
    expect(queue.snapshot().items.map((i) => i.prompt)).toEqual(["hello"]);
  });

  it("ignores empty / whitespace prompts on enqueue", () => {
    const queue = createComposerPromptQueue();
    expect(queue.enqueue({ prompt: "", mode: "queue" })).toBeNull();
    expect(queue.enqueue({ prompt: "   ", mode: "queue" })).toBeNull();
    expect(queue.snapshot().items).toEqual([]);
  });

  it("preserves the queue mode on each item", () => {
    const queue = createComposerPromptQueue();
    queue.enqueue({ prompt: "a", mode: "queue" });
    queue.enqueue({ prompt: "b", mode: "steer" });
    const items = queue.snapshot().items;
    expect(items.map((i) => i.mode)).toEqual(["queue", "steer"]);
  });

  it("attaches the supplied context to the queued item", () => {
    const queue = createComposerPromptQueue();
    queue.enqueue({
      prompt: "a",
      mode: "queue",
      context: { filePaths: ["src/a.ts"] },
    });
    expect(queue.snapshot().items[0]!.context).toEqual({ filePaths: ["src/a.ts"] });
  });

  it("takeNextDeliverable pops the oldest queue-mode item only", () => {
    const queue = createComposerPromptQueue();
    queue.enqueue({ prompt: "a", mode: "queue" });
    queue.enqueue({ prompt: "b", mode: "steer" });
    queue.enqueue({ prompt: "c", mode: "queue" });
    const first = queue.takeNextDeliverable();
    expect(first?.prompt).toBe("a");
    expect(queue.snapshot().items.map((i) => i.prompt)).toEqual(["b", "c"]);
    const second = queue.takeNextDeliverable();
    expect(second?.prompt).toBe("c");
    expect(queue.snapshot().items.map((i) => i.prompt)).toEqual(["b"]);
    expect(queue.takeNextDeliverable()).toBeNull();
  });

  it("takeNextSteer pops the oldest steer-mode item only", () => {
    const queue = createComposerPromptQueue();
    queue.enqueue({ prompt: "a", mode: "queue" });
    queue.enqueue({ prompt: "b", mode: "steer" });
    queue.enqueue({ prompt: "c", mode: "steer" });
    const first = queue.takeNextSteer();
    expect(first?.prompt).toBe("b");
    expect(queue.snapshot().items.map((i) => i.prompt)).toEqual(["a", "c"]);
    const second = queue.takeNextSteer();
    expect(second?.prompt).toBe("c");
    expect(queue.takeNextSteer()).toBeNull();
  });

  it("remove drops a single item by id", () => {
    const queue = createComposerPromptQueue();
    const a = queue.enqueue({ prompt: "a", mode: "queue" });
    queue.enqueue({ prompt: "b", mode: "queue" });
    queue.remove(a!.id);
    expect(queue.snapshot().items.map((i) => i.prompt)).toEqual(["b"]);
  });

  it("clear empties the queue", () => {
    const queue = createComposerPromptQueue();
    queue.enqueue({ prompt: "a", mode: "queue" });
    queue.enqueue({ prompt: "b", mode: "steer" });
    queue.clear();
    expect(queue.snapshot().items).toEqual([]);
  });

  it("assigns unique ids to each item", () => {
    const queue = createComposerPromptQueue();
    queue.enqueue({ prompt: "a", mode: "queue" });
    queue.enqueue({ prompt: "b", mode: "queue" });
    const ids = queue.snapshot().items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("composerPromptQueue.defaultQueueMode", () => {
  it("returns queue (non-destructive default)", () => {
    expect(defaultQueueMode()).toBe("queue");
  });
});
