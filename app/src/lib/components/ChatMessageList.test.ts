import { describe, expect, it } from "vitest";
import type {
  ChatMessage,
  ChatMessagePart,
  ToolCallRecord,
} from "../domain/contracts";
import ChatMessageList from "./ChatMessageList.svelte";
import { mountComponent } from "./_testComponentMount";

interface BuildOpts {
  parts?: ChatMessagePart[];
  content?: string;
  role?: ChatMessage["role"];
  id?: string;
  toolCalls?: ToolCallRecord[];
}

function assistantMessage(overrides: BuildOpts = {}): ChatMessage {
  const { parts, content = "", id = "msg-1", role = "assistant", toolCalls } = overrides;
  return {
    id,
    role,
    content,
    createdAt: "2026-06-19T00:00:00.000Z",
    ...(parts ? { parts } : {}),
    ...(toolCalls ? { toolCalls } : {}),
  };
}

function mountList(messages: ChatMessage[], isGenerating = false) {
  return mountComponent(ChatMessageList, {
    messages,
    isEmpty: messages.length === 0,
    isGenerating,
  });
}

/** Returns the ordered list of "part kind" markers inside a message body. */
function bodyPartKinds(host: HTMLElement, messageId: string): string[] {
  const message = host.querySelector(`[data-message-id="${messageId}"]`);
  if (!message) {
    throw new Error(`message ${messageId} not rendered`);
  }
  const body = message.querySelector(".chat-message-body");
  if (!body) {
    throw new Error(`message ${messageId} has no .chat-message-body`);
  }
  const kinds: string[] = [];
  // `body.children` (HTMLCollection) covers only element children, skipping the
  // text/comment placeholders Svelte emits between blocks.
  Array.from(body.children).forEach((el) => {
    if (el.classList.contains("step-separator")) {
      kinds.push("step");
    } else if (el.classList.contains("reasoning-block")) {
      kinds.push("reasoning");
    } else if (el.classList.contains("subtask-card")) {
      kinds.push("subtask");
    } else if (el.classList.contains("inline-diff")) {
      kinds.push("diff");
    } else if (el.classList.contains("chat-message-attachments")) {
      kinds.push(el.classList.contains("chat-message-attachments-images") ? "image" : "file");
    } else if (
      el.classList.contains("chat-message-content") ||
      el.classList.contains("chat-message-content-prose")
    ) {
      kinds.push("text");
    } else if (el.classList.contains("chat-tool-cards")) {
      kinds.push("tools");
    } else {
      kinds.push("other");
    }
  });
  return kinds;
}

describe("ChatMessageList.svelte — interleaved part rendering (M12-T1)", () => {
  it("renders a message whose parts interleave text / reasoning / text in that order", () => {
    const message = assistantMessage({
      content: "before\nafter",
      parts: [
        { type: "text", id: "t1", text: "before" },
        { type: "reasoning", id: "r1", text: "thinking" },
        { type: "text", id: "t2", text: "after" },
      ],
    });
    const { host } = mountList([message]);
    expect(bodyPartKinds(host, "msg-1")).toEqual(["text", "reasoning", "text"]);
  });

  it("renders the reasoning text at its interleaved position, not joined into a top block", () => {
    const message = assistantMessage({
      content: "intro\noutro",
      parts: [
        { type: "text", id: "t1", text: "intro" },
        { type: "reasoning", id: "r1", text: "mid-thought" },
        { type: "text", id: "t2", text: "outro" },
      ],
    });
    const { host } = mountList([message]);
    const body = host.querySelector("[data-message-id='msg-1'] .chat-message-body");
    const contents = Array.from(body?.querySelectorAll(".chat-message-content") ?? []).map((el) =>
      el.textContent?.trim(),
    );
    const reasoningText = body?.querySelector(".reasoning-text")?.textContent?.trim();
    expect(contents).toEqual(["intro", "outro"]);
    expect(reasoningText).toBe("mid-thought");
  });

  it("renders a step separator at the finish part's position, between content chunks", () => {
    const message = assistantMessage({
      content: "first chunk\nsecond chunk",
      parts: [
        { type: "text", id: "t1", text: "first chunk" },
        { type: "step", phase: "start", index: 0 },
        { type: "step", phase: "finish", index: 0, cost: 0.01 },
        { type: "text", id: "t2", text: "second chunk" },
      ],
    });
    const { host } = mountList([message]);
    expect(bodyPartKinds(host, "msg-1")).toEqual(["text", "step", "text"]);
  });

  it("interleaves reasoning, subtask, step, image, and diff parts in stored order", () => {
    const message = assistantMessage({
      content: "step 1\nstep 2",
      parts: [
        { type: "reasoning", id: "r1", text: "plan" },
        { type: "text", id: "t1", text: "step 1" },
        { type: "subtask", id: "s1", agent: "explore", status: "completed" },
        { type: "step", phase: "start", index: 0 },
        { type: "step", phase: "finish", index: 0, cost: 0.01 },
        { type: "file", id: "f1", mime: "image/png", url: "file:///x.png" },
        { type: "text", id: "t2", text: "step 2" },
        { type: "diff", id: "d1", files: ["a.ts"] },
        { type: "cost", cost: 0.02 },
      ],
    });
    const { host } = mountList([message]);
    // cost parts carry no UI; the step boundary anchors at the finish. The
    // subtask (between text-1 and the step start) renders before the boundary.
    expect(bodyPartKinds(host, "msg-1")).toEqual([
      "reasoning",
      "text",
      "subtask",
      "step",
      "image",
      "text",
      "diff",
    ]);
  });

  it("renders message.content as a single content block when there are no text parts (streaming case)", () => {
    // Live streaming: text lives on message.content, parts has reasoning only.
    const message = assistantMessage({
      content: "streaming reply",
      parts: [{ type: "reasoning", id: "r1", text: "thinking" }],
    });
    const { host } = mountList([message]);
    expect(bodyPartKinds(host, "msg-1")).toEqual(["reasoning", "text"]);
  });

  it("renders a single content block for a flat message with no parts", () => {
    const message = assistantMessage({ content: "just text, no parts" });
    const { host } = mountList([message]);
    expect(bodyPartKinds(host, "msg-1")).toEqual(["text"]);
  });

  it("renders tool cards after the part slots, outside the interleave order", () => {
    const message = assistantMessage({
      content: "answer",
      toolCalls: [
        {
          callId: "c1",
          toolName: "read_file",
          status: "success",
          input: { path: "a.ts" },
          output: "x",
        },
      ],
      parts: [{ type: "text", id: "t1", text: "answer" }],
    });
    const { host } = mountList([message]);
    expect(bodyPartKinds(host, "msg-1")).toEqual(["text", "tools"]);
  });

  it("renders the totals footer after the body when the message has a cost part", () => {
    const message = assistantMessage({
      content: "answer",
      parts: [
        { type: "text", id: "t1", text: "answer" },
        { type: "cost", cost: 0.05 },
      ],
    });
    const { host } = mountList([message]);
    const messageEl = host.querySelector("[data-message-id='msg-1']");
    const body = messageEl?.querySelector(".chat-message-body");
    const footer = messageEl?.querySelector(".chat-message-totals");
    expect(body).not.toBeNull();
    expect(footer).not.toBeNull();
    // Footer is a sibling after the body, not inside it.
    expect(footer?.parentElement).toBe(messageEl);
    expect(body?.parentElement).toBe(messageEl);
  });

  it("preserves reasoning expand/collapse state per reasoning part id", () => {
    const message = assistantMessage({
      content: "a\nb",
      parts: [
        { type: "reasoning", id: "r1", text: "first thought" },
        { type: "text", id: "t1", text: "a" },
        { type: "reasoning", id: "r2", text: "second thought" },
        { type: "text", id: "t2", text: "b" },
      ],
    });
    const { host } = mountList([message]);
    const blocks = host.querySelectorAll("[data-message-id='msg-1'] .reasoning-block");
    expect(blocks).toHaveLength(2);
    // Both collapsed by default.
    blocks.forEach((block) => {
      expect(block.classList.contains("reasoning-block-expanded")).toBe(false);
    });
  });
});
