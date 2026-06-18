import { describe, expect, it } from "vitest";
import { countPermissionRules, readConfigSummary } from "./opencodeStatusSummary";

/**
 * M5-T4 — status-popover config aggregation: permission-rule counting across
 * the polymorphic `permission:` config shape, plus default-model / agent
 * extraction.
 */
describe("opencodeStatusSummary", () => {
  describe("countPermissionRules", () => {
    it("returns 0 for a bare action string", () => {
      expect(countPermissionRules("allow")).toBe(0);
      expect(countPermissionRules("deny")).toBe(0);
    });

    it("counts every pattern in a per-tool map", () => {
      const permission = {
        bash: { "rm -rf": "ask", "ls": "allow" },
        edit: { "src/**": "ask" },
      };
      expect(countPermissionRules(permission)).toBe(3);
    });

    it("counts a bare-action per tool as one rule", () => {
      const permission = { bash: "allow", edit: "deny" };
      expect(countPermissionRules(permission)).toBe(2);
    });

    it("counts entries in a flat rule array", () => {
      const permission = [
        { permission: "bash", pattern: "ls", action: "allow" },
        { permission: "edit", pattern: "*.ts", action: "ask" },
      ];
      expect(countPermissionRules(permission)).toBe(2);
    });

    it("returns 0 for null / undefined / unknown shapes", () => {
      expect(countPermissionRules(null)).toBe(0);
      expect(countPermissionRules(undefined)).toBe(0);
      expect(countPermissionRules(42)).toBe(0);
    });
  });

  describe("readConfigSummary", () => {
    it("extracts default model and agent", () => {
      const config = {
        model: "anthropic/claude",
        default_agent: "plan",
        permission: { bash: { ls: "allow" } },
      };
      expect(readConfigSummary(config)).toEqual({
        permissionRuleCount: 1,
        defaultModelId: "anthropic/claude",
        defaultAgentId: "plan",
      });
    });

    it("returns null for blank model / agent", () => {
      expect(readConfigSummary({ model: "  ", default_agent: "" })).toEqual({
        permissionRuleCount: 0,
        defaultModelId: null,
        defaultAgentId: null,
      });
    });

    it("returns null model/agent when absent", () => {
      expect(readConfigSummary({})).toEqual({
        permissionRuleCount: 0,
        defaultModelId: null,
        defaultAgentId: null,
      });
    });

    it("tolerates a non-object permission value", () => {
      expect(readConfigSummary({ permission: "allow" }).permissionRuleCount).toBe(0);
    });
  });
});
