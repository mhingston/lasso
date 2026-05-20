import type { Capability, CapabilityRegistry } from "./types.js";

export class DefaultCapabilityRegistry implements CapabilityRegistry {
  private capabilities = new Map<string, Capability>();

  constructor() {
    this.registerDefaults();
  }

  getCapabilities(): Capability[] {
    return Array.from(this.capabilities.values());
  }

  hasCapability(id: string): boolean {
    return this.capabilities.has(id);
  }

  getCapability(id: string): Capability | undefined {
    return this.capabilities.get(id);
  }

  registerCapability(capability: Capability): void {
    this.capabilities.set(capability.id, capability);
  }

  private registerDefaults(): void {
    this.registerCapability({
      id: "bash",
      kind: "tool",
      name: "Bash Shell",
      prerequisites: [],
      risks: [
        "Executes arbitrary system commands",
        "Can modify filesystem",
        "May have elevated permissions"
      ],
      verification: [
        "Verify command output",
        "Check exit codes"
      ]
    });

    this.registerCapability({
      id: "git",
      kind: "tool",
      name: "Git Version Control",
      prerequisites: ["bash"],
      risks: [
        "Modifies repository history",
        "Can overwrite remote changes"
      ],
      verification: [
        "Verify branch state",
        "Check commit status"
      ]
    });

    this.registerCapability({
      id: "node",
      kind: "tool",
      name: "Node.js Runtime",
      prerequisites: ["bash"],
      risks: [
        "Executes arbitrary JavaScript",
        "Network access capability"
      ],
      verification: [
        "Verify Node.js version",
        "Check package installation"
      ]
    });

    this.registerCapability({
      id: "llm-review",
      kind: "llm",
      name: "LLM Code Review",
      prerequisites: [],
      risks: [
        "May produce incorrect suggestions",
        "Non-deterministic outputs"
      ],
      verification: [
        "Verify review completeness",
        "Check for hallucinated references"
      ]
    });

    this.registerCapability({
      id: "human-approval",
      kind: "human",
      name: "Human Approval Gate",
      prerequisites: [],
      risks: [
        "Introduces workflow delay",
        "Requires human availability"
      ],
      verification: [
        "Confirm approval received",
        "Verify approver identity"
      ]
    });
  }
}
