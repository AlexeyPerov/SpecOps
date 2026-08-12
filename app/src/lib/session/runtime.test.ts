import { describe, expect, it } from "vitest";
import {
  AGENT_RUNTIME_IDS,
  PRODUCT_RUNTIME_IDS,
  agentRuntimeDescriptor,
  allAgentRuntimeDescriptors,
  productRuntimeDescriptors,
  isAgentRuntimeId,
  isProductRuntimeId,
} from "./runtime";

describe("runtime identity", () => {
  it("lists the product runtimes in the initial delivery order", () => {
    expect(PRODUCT_RUNTIME_IDS).toEqual(["claude", "codex", "opencode", "cursor"]);
  });

  it("includes the deterministic dev fake runtime in the full id set", () => {
    expect(AGENT_RUNTIME_IDS).toEqual(["claude", "codex", "opencode", "cursor", "fake"]);
  });

  it("narrowing rejects unknown ids and separates product from dev", () => {
    expect(isAgentRuntimeId("claude")).toBe(true);
    expect(isAgentRuntimeId("fake")).toBe(true);
    expect(isAgentRuntimeId("gemini")).toBe(false);
    expect(isAgentRuntimeId(7)).toBe(false);
    expect(isProductRuntimeId("claude")).toBe(true);
    expect(isProductRuntimeId("fake")).toBe(false);
  });

  it("every runtime has a descriptor and a stable label", () => {
    for (const id of AGENT_RUNTIME_IDS) {
      const descriptor = agentRuntimeDescriptor(id);
      expect(descriptor.id).toBe(id);
      expect(descriptor.label.length).toBeGreaterThan(0);
    }
    expect(allAgentRuntimeDescriptors()).toHaveLength(AGENT_RUNTIME_IDS.length);
    // Product descriptors exclude the dev fake.
    expect(productRuntimeDescriptors().map((d) => d.id)).toEqual([...PRODUCT_RUNTIME_IDS]);
    expect(productRuntimeDescriptors().every((d) => !d.dev)).toBe(true);
    expect(agentRuntimeDescriptor("fake").dev).toBe(true);
  });
});
