import type { Capability, CapabilityRegistry } from "./types.js";

export interface CapabilityMatchResult {
  matched: Capability[];
  missing: string[];
}

export function matchCapabilities(
  requiredTools: string[],
  registry: CapabilityRegistry
): CapabilityMatchResult {
  const matched: Capability[] = [];
  const missing: string[] = [];

  for (const toolId of requiredTools) {
    const capability = registry.getCapability(toolId);
    if (capability) {
      matched.push(capability);
    } else {
      missing.push(toolId);
    }
  }

  return { matched, missing };
}
