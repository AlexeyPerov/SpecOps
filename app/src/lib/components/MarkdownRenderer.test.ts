import { describe, expect, it } from "vitest";
import MarkdownRenderer from "./MarkdownRenderer.svelte";
import { mountComponent } from "./_testComponentMount";

describe("MarkdownRenderer.svelte", () => {
  it("renders headings as actual heading elements inside the prose container", () => {
    const { host } = mountComponent(MarkdownRenderer, {
      source: "# Title",
    });
    expect(host.querySelector(".chat-prose")).not.toBeNull();
    expect(host.querySelector(".chat-prose h1")?.textContent).toBe("Title");
  });

  it("renders a code block inside a <pre> with the language class", () => {
    const { host } = mountComponent(MarkdownRenderer, {
      source: "```ts\nconst x = 1;\n```",
    });
    const pre = host.querySelector<HTMLPreElement>(".chat-prose pre");
    expect(pre).not.toBeNull();
    expect(pre?.querySelector("code")?.className).toContain("language-ts");
  });

  it("emits no <script> after sanitization", () => {
    const { host } = mountComponent(MarkdownRenderer, {
      source: "hello\n\n<script>alert(1)</script>",
    });
    expect(host.querySelector(".chat-prose script")).toBeNull();
  });

  it("renders emphasis and links", () => {
    const { host } = mountComponent(MarkdownRenderer, {
      source: "_italic_ and [SpecOps](https://example.com)",
    });
    expect(host.querySelector(".chat-prose em")?.textContent).toBe("italic");
    const link = host.querySelector<HTMLAnchorElement>(".chat-prose a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.textContent).toBe("SpecOps");
  });

  it("re-renders when the source prop changes (re-mount)", () => {
    const first = mountComponent(MarkdownRenderer, { source: "# A" });
    expect(first.host.querySelector(".chat-prose h1")?.textContent).toBe("A");
    first.unmount();
    const second = mountComponent(MarkdownRenderer, { source: "# B" });
    expect(second.host.querySelector(".chat-prose h1")?.textContent).toBe("B");
  });
});
