export interface Capability {
  id: string;
  kind: "tool" | "llm" | "service" | "human";
  name: string;
  prerequisites: string[];
  risks: string[];
  verification: string[];
}

export interface CapabilityRegistry {
  getCapabilities(): Capability[];
  hasCapability(id: string): boolean;
  getCapability(id: string): Capability | undefined;
  registerCapability(capability: Capability): void;
}
