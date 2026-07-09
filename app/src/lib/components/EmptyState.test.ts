import { describe, expect, it } from "vitest";
import EmptyState from "./EmptyState.svelte";
import { mountComponent } from "./_testComponentMount";

/**
 * Props shape mirrors EmptyState's `interface Props` (optionals kept optional)
 * so the partial-object call sites satisfy `mountComponent`'s generic.
 */
type EmptyStateProps = {
  title: string;
  description?: string;
  variant?: "centered" | "inline";
  role?: "status" | "alert" | null;
  class?: string;
};

describe("EmptyState", () => {
  it("renders a title-only centered state", () => {
    const { host } = mountComponent<EmptyStateProps>(EmptyState, { title: "Nothing here" });

    const root = host.querySelector(".empty-state");
    expect(root).toBeTruthy();
    expect(root?.getAttribute("role")).toBe("status");
    expect(root?.classList.contains("empty-state-centered")).toBe(true);
    expect(host.querySelector(".empty-state-title")?.textContent).toBe("Nothing here");
    expect(host.querySelector(".empty-state-description")).toBeNull();
    expect(host.querySelector(".empty-state-actions")).toBeNull();
  });

  it("renders a title, description, and inline variant", () => {
    const { host } = mountComponent<EmptyStateProps>(EmptyState, {
      title: "No todos yet",
      description: "The agent will list tasks here as it works.",
      variant: "inline",
    });

    const root = host.querySelector(".empty-state");
    expect(root?.classList.contains("empty-state-inline")).toBe(true);
    expect(host.querySelector(".empty-state-description")?.textContent).toBe(
      "The agent will list tasks here as it works.",
    );
  });

  it("supports an alert role", () => {
    const { host } = mountComponent<EmptyStateProps>(EmptyState, {
      title: "Failed",
      role: "alert",
    });
    expect(host.querySelector(".empty-state")?.getAttribute("role")).toBe("alert");
  });

  it("forwards an extra class hook and omits actions region when no slot is given", () => {
    const { host } = mountComponent<EmptyStateProps>(EmptyState, {
      title: "No workspaces",
      class: "wm-empty",
    });
    const root = host.querySelector(".empty-state");
    expect(root?.classList.contains("wm-empty")).toBe(true);
    expect(host.querySelector(".empty-state-actions")).toBeNull();
  });

  it("omits the role attribute when role is null", () => {
    const { host } = mountComponent<EmptyStateProps>(EmptyState, { title: "Quiet", role: null });
    expect(host.querySelector(".empty-state")?.getAttribute("role")).toBeNull();
  });
});
