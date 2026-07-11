import { describe, expect, it, vi } from "vitest";
import SearchablePickerShellHarness from "./SearchablePickerShell.harness.svelte";
import { mountComponent } from "./_testComponentMount";
import { pickerOptionId } from "../picker/pickerOptionId";

type HarnessProps = {
  open?: boolean;
  query?: string;
  activeIndex?: number;
  optionCount?: number;
  onClose?: () => void;
  onSelect?: (index: number) => void;
};

function dispatchKey(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("SearchablePickerShell", () => {
  it("renders nothing when closed", () => {
    const { host } = mountComponent<HarnessProps>(SearchablePickerShellHarness, {
      open: false,
    });
    expect(host.querySelector('[role="combobox"]')).toBeNull();
  });

  it("exposes dialog/combobox/listbox semantics and stable option ids", () => {
    const { host } = mountComponent<HarnessProps>(SearchablePickerShellHarness, {
      open: true,
      activeIndex: 1,
    });

    const dialog = host.querySelector(".searchable-picker-shell");
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");

    const input = host.querySelector('[role="combobox"]');
    expect(input).toBeTruthy();
    expect(input?.getAttribute("aria-autocomplete")).toBe("list");
    expect(input?.getAttribute("aria-controls")).toBe("test-picker-list");
    expect(input?.getAttribute("aria-expanded")).toBe("true");
    expect(input?.getAttribute("aria-activedescendant")).toBe(pickerOptionId("test-opt", 1));

    const list = host.querySelector("#test-picker-list");
    expect(list?.getAttribute("role")).toBe("listbox");

    const options = host.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(3);
    expect(options[0]?.id).toBe(pickerOptionId("test-opt", 0));
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector(".searchable-picker-footer")?.textContent).toMatch(/navigate/);
  });

  it("keeps focus on the query input while arrow-navigating", async () => {
    const { host } = mountComponent<HarnessProps>(SearchablePickerShellHarness, {
      open: true,
      activeIndex: 0,
    });

    const { tick } = await import("svelte");
    await tick();
    const input = host.querySelector(".searchable-picker-query") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    dispatchKey(input, "ArrowDown");
    await tick();
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-activedescendant")).toBe(pickerOptionId("test-opt", 1));

    dispatchKey(input, "End");
    await tick();
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-activedescendant")).toBe(pickerOptionId("test-opt", 2));
  });

  it("selects the active option on Enter", () => {
    const onSelect = vi.fn();
    const { host } = mountComponent<HarnessProps>(SearchablePickerShellHarness, {
      open: true,
      activeIndex: 2,
      onSelect,
    });
    const input = host.querySelector(".searchable-picker-query") as HTMLInputElement;
    dispatchKey(input, "Enter");
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("closes on Escape via the overlay host", () => {
    const onClose = vi.fn();
    const { host } = mountComponent<HarnessProps>(SearchablePickerShellHarness, {
      open: true,
      onClose,
    });
    const dialog = host.querySelector(".searchable-picker-shell") as HTMLElement;
    dispatchKey(dialog, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("selects an option on pointer click without requiring consumer key logic", () => {
    const onSelect = vi.fn();
    const { host } = mountComponent<HarnessProps>(SearchablePickerShellHarness, {
      open: true,
      activeIndex: 0,
      onSelect,
    });
    const option = host.querySelector(`#${pickerOptionId("test-opt", 1)}`) as HTMLElement;
    option.click();
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
