import { describe, it, expect } from "vitest";
import { DefaultCapabilityRegistry } from "../../src/capabilities/registry.js";
import type { Capability } from "../../src/capabilities/types.js";

describe("capability registry", () => {
  describe("DefaultCapabilityRegistry", () => {
    describe("CRUD operations", () => {
      it("should register and retrieve a capability", () => {
        const registry = new DefaultCapabilityRegistry();
        const cap: Capability = {
          id: "test-cap",
          kind: "tool",
          name: "Test Capability",
          prerequisites: [],
          risks: [],
          verification: []
        };

        registry.registerCapability(cap);

        expect(registry.hasCapability("test-cap")).toBe(true);
        expect(registry.getCapability("test-cap")).toEqual(cap);
      });

      it("should return undefined for non-existent capability", () => {
        const registry = new DefaultCapabilityRegistry();

        expect(registry.hasCapability("nonexistent")).toBe(false);
        expect(registry.getCapability("nonexistent")).toBeUndefined();
      });

      it("should list all registered capabilities", () => {
        const registry = new DefaultCapabilityRegistry();
        const initialCount = registry.getCapabilities().length;
        const cap1: Capability = {
          id: "cap1",
          kind: "tool",
          name: "Cap 1",
          prerequisites: [],
          risks: [],
          verification: []
        };
        const cap2: Capability = {
          id: "cap2",
          kind: "llm",
          name: "Cap 2",
          prerequisites: [],
          risks: [],
          verification: []
        };

        registry.registerCapability(cap1);
        registry.registerCapability(cap2);

        const all = registry.getCapabilities();
        expect(all).toHaveLength(initialCount + 2);
        expect(all).toContainEqual(cap1);
        expect(all).toContainEqual(cap2);
      });

      it("should overwrite existing capability on re-register", () => {
        const registry = new DefaultCapabilityRegistry();
        const initialCount = registry.getCapabilities().length;
        const cap1: Capability = {
          id: "test",
          kind: "tool",
          name: "Original",
          prerequisites: [],
          risks: [],
          verification: []
        };
        const cap2: Capability = {
          id: "test",
          kind: "llm",
          name: "Updated",
          prerequisites: ["other"],
          risks: ["risk1"],
          verification: ["verify1"]
        };

        registry.registerCapability(cap1);
        registry.registerCapability(cap2);

        expect(registry.getCapabilities()).toHaveLength(initialCount + 1);
        expect(registry.getCapability("test")?.name).toBe("Updated");
        expect(registry.getCapability("test")?.prerequisites).toEqual(["other"]);
      });
    });

    describe("pre-registered capabilities", () => {
      it("should have bash capability pre-registered", () => {
        const registry = new DefaultCapabilityRegistry();

        expect(registry.hasCapability("bash")).toBe(true);
        const bash = registry.getCapability("bash");
        expect(bash?.kind).toBe("tool");
        expect(bash?.risks.length).toBeGreaterThan(0);
      });

      it("should have git capability pre-registered", () => {
        const registry = new DefaultCapabilityRegistry();

        expect(registry.hasCapability("git")).toBe(true);
        const git = registry.getCapability("git");
        expect(git?.kind).toBe("tool");
        expect(git?.prerequisites).toContain("bash");
      });

      it("should have node capability pre-registered", () => {
        const registry = new DefaultCapabilityRegistry();

        expect(registry.hasCapability("node")).toBe(true);
        const node = registry.getCapability("node");
        expect(node?.kind).toBe("tool");
        expect(node?.prerequisites).toContain("bash");
      });

      it("should have llm-review capability pre-registered", () => {
        const registry = new DefaultCapabilityRegistry();

        expect(registry.hasCapability("llm-review")).toBe(true);
        const llmReview = registry.getCapability("llm-review");
        expect(llmReview?.kind).toBe("llm");
        expect(llmReview?.verification.length).toBeGreaterThan(0);
      });

      it("should have human-approval capability pre-registered", () => {
        const registry = new DefaultCapabilityRegistry();

        expect(registry.hasCapability("human-approval")).toBe(true);
        const humanApproval = registry.getCapability("human-approval");
        expect(humanApproval?.kind).toBe("human");
      });
    });
  });
});
