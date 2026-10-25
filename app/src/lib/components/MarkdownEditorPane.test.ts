import { describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import MarkdownEditorPane from "./MarkdownEditorPane.svelte";
import { mountComponent } from "./_testComponentMount";

vi.mock("./DocumentEditor.svelte", () => ({ default: () => {} }));

describe("document preview modes", () => {
  it("opens HTML in preview and keeps the source editor mounted when toggling", () => {
    const { host } = mountComponent(MarkdownEditorPane, {
      paneId: "main", contextId: "tabs-default", language: "html", markdownEnabled: false,
      content: "<h1>Hello</h1>", documentFilePath: "/tmp/page.html",
    });
    flushSync();
    expect(host.querySelector("iframe")).not.toBeNull();
    const editor = host.querySelector(".markdown-editor-pane");
    const buttons = [...host.querySelectorAll("button")];
    buttons.find(b => b.textContent === "source")!.click();
    flushSync();
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector(".html-source-hidden")).toBeNull();
    expect(host.querySelector(".markdown-editor-pane")).toBe(editor);
    buttons.find(b => b.textContent === "preview")!.click();
    flushSync();
    expect(host.querySelector("iframe")).not.toBeNull();
    expect(host.querySelector(".markdown-editor-pane")).toBe(editor);
  });

  it("retains Markdown's edit default and does not show HTML controls for text", () => {
    const markdown = mountComponent(MarkdownEditorPane, { paneId: "main", contextId: "tabs-default", content: "# Heading" });
    const text = mountComponent(MarkdownEditorPane, { paneId: "main", contextId: "tabs-default", language: "plaintext", markdownEnabled: false, content: "Hello" });
    flushSync();
    expect(markdown.host.querySelector(".mode-button-active")?.textContent?.trim()).toBe("edit");
    expect(text.host.querySelector("button, iframe")).toBeNull();
  });
});
