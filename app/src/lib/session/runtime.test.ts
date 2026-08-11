import { describe, expect, it } from "vitest";
import {
  AGENT_RUNTIME_IDS,
  agentRuntimeDescriptor,
  allAgentRuntimeDescriptors,
  isAgentRuntimeId,
} from "./runtime";

describe("runtime identity", () => {
  it("lists runtimes in the initial delivery order", () => {
    expect(AGENT_RUNTIME_IDS).toEqual(["claude", "codex", "opencode", "cursor"]);
  });

  it("narrowing rejects unknown ids", () => {
    expect(isAgentRuntimeId("claude")).toBe(true);
    expect(isAgentRuntimeId("gemini")).toBe(false);
    expect(isAgentRuntimeId(7)).toBe(false);
  });

  it("every runtime has a descriptor and a stable label", () => {
    for (const id of AGENT_RUNTIME_IDS) {
      const descriptor = agentRuntimeDescriptor(id);
      expect(descriptor.id).toBe(id);
      expect(descriptor.label.length).toBeGreaterThan(0);
    }
    expect(allAgentRuntimeDescriptors()).toHaveLength(AGENT_RUNTIME_IDS.length);
  });
});
