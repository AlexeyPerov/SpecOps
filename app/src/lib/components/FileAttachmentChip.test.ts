import { describe, expect, it } from "vitest";
import type { MessageAttachment } from "../ai/chatAttachments";
import FileAttachmentChip from "./FileAttachmentChip.svelte";
import { mountComponent } from "./_testComponentMount";

function attachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: "f-1",
    mime: "application/pdf",
    filename: "report.pdf",
    url: "file:///tmp/report.pdf",
    isImage: false,
    ...overrides,
  };
}

describe("FileAttachmentChip.svelte", () => {
  it("renders an anchor pointing at the attachment url with the download attribute", () => {
    const { host } = mountComponent(FileAttachmentChip, {
      attachment: attachment({ url: "file:///tmp/data.bin", filename: "data.bin" }),
    });
    const link = host.querySelector<HTMLAnchorElement>(".file-attachment-chip");
    expect(link?.tagName).toBe("A");
    expect(link?.getAttribute("href")).toBe("file:///tmp/data.bin");
    expect(link?.getAttribute("download")).toBe("data.bin");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("renders the filename as the display name", () => {
    const { host } = mountComponent(FileAttachmentChip, {
      attachment: attachment({ filename: "diagram.svg" }),
    });
    expect(host.querySelector(".file-attachment-name")?.textContent).toBe("diagram.svg");
  });

  it("falls back to a generic 'file' label when no filename is set", () => {
    const { host } = mountComponent(FileAttachmentChip, {
      attachment: attachment({ filename: undefined }),
    });
    expect(host.querySelector(".file-attachment-name")?.textContent).toBe("file");
  });

  it("derives the extension badge from the filename extension (uppercased)", () => {
    const { host } = mountComponent(FileAttachmentChip, {
      attachment: attachment({ filename: "archive.tar.gz" }),
    });
    expect(host.querySelector(".file-attachment-ext")?.textContent).toBe("GZ");
  });

  it("falls back to the mime subtype when there is no filename extension", () => {
    const { host } = mountComponent(FileAttachmentChip, {
      attachment: attachment({ filename: "noext", mime: "application/json" }),
    });
    expect(host.querySelector(".file-attachment-ext")?.textContent).toBe("JSON");
  });

  it("falls back to the full mime (uppercased) when neither filename extension nor subtype is available", () => {
    const { host } = mountComponent(FileAttachmentChip, {
      attachment: attachment({ filename: "noext", mime: "binary" }),
    });
    expect(host.querySelector(".file-attachment-ext")?.textContent).toBe("BINARY");
  });

  it("includes a download affordance title", () => {
    const { host } = mountComponent(FileAttachmentChip, {
      attachment: attachment({ filename: "report.pdf" }),
    });
    expect(host.querySelector(".file-attachment-chip")?.getAttribute("title")).toContain(
      "Download report.pdf",
    );
  });
});
