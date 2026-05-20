import { describe, it, expect } from "vitest";
import { matchCapabilities } from "../../src/capabilities/matcher.js";
import { DefaultCapabilityRegistry } from "../../src/capabilities/registry.js";
import type { Capability } from "../../src/capabilities/types.js";

describe("capability matcher", () => {
  describe("matchCapabilities", () => {
    it("should match all available capabilities", () => {
      const registry = new DefaultCapabilityRegistry();

      const result = matchCapabilities(["bash", "git"], registry);

      expect(result.matched).toHaveLength(2);
      expect(result.missing).toHaveLength(0);
      expect(result.matched.map(c => c.id)).toContain("bash");
      expect(result.matched.map(c => c.id)).toContain("git");
    });

    it("should report missing capabilities", () => {
      const registry = new DefaultCapabilityRegistry();

      const result = matchCapabilities(["bash", "nonexistent-tool"], registry);

      expect(result.matched).toHaveLength(1);
      expect(result.missing).toHaveLength(1);
      expect(result.missing).toContain("nonexistent-tool");
      expect(result.matched.map(c => c.id)).toContain("bash");
    });

    it("should handle empty required tools", () => {
      const registry = new DefaultCapabilityRegistry();

      const result = matchCapabilities([], registry);

      expect(result.matched).toHaveLength(0);
      expect(result.missing).toHaveLength(0);
    });

    it("should match capability with prerequisites declared", () => {
      const registry = new DefaultCapabilityRegistry();
      const custom: Capability = {
        id: "custom-tool",
        kind: "tool",
        name: "Custom Tool",
        prerequisites: ["bash", "git"],
        risks: [],
        verification: []
      };
      registry.registerCapability(custom);

      const result = matchCapabilities(["custom-tool"], registry);

      expect(result.matched).toHaveLength(1);
      expect(result.missing).toHaveLength(0);
      expect(result.matched[0].id).toBe("custom-tool");
    });

    it("should include all pre-registered capabilities", () => {
      const registry = new DefaultCapabilityRegistry();

      const result = matchCapabilities(["bash", "git", "node", "llm-review", "human-approval"], registry);

      expect(result.matched).toHaveLength(5);
      expect(result.missing).toHaveLength(0);
    });
  });
});
