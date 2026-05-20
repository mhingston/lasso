import type { TaskGraph, WorkflowStage } from "./graph-builder.js";
import type { CapabilityRegistry } from "../capabilities/types.js";
import { matchCapabilities } from "../capabilities/matcher.js";

export type RiskLevel = "low" | "medium" | "high";

export interface CapabilityRisk {
  allAvailable: boolean;
  missing: string[];
  riskFactors: string[];
}

export interface RiskModel {
  overallRisk: RiskLevel;
  approvalRequired: boolean;
  candidateSourceKind: "branch" | "patchFile" | "pr" | null;
  verificationBreadth: "narrow" | "moderate" | "comprehensive";
  stageRisks: Map<string, StageRisk>;
  mitigations: string[];
  capabilityRisk?: CapabilityRisk;
}

export interface StageRisk {
  stageId: string;
  risk: RiskLevel;
  factors: string[];
}

export function analyzeRisks(graph: TaskGraph, registry?: CapabilityRegistry): RiskModel {
  const stageRisks = new Map<string, StageRisk>();
  let approvalRequired = false;
  let candidateSourceKind: "branch" | "patchFile" | "pr" | null = null;
  let capabilityRisk: CapabilityRisk | undefined;
  
  if (graph.capabilityMatch && registry) {
    const requiredTools = graph.capabilityMatch.matched.concat(graph.capabilityMatch.missing);
    const { matched, missing } = matchCapabilities(requiredTools, registry);
    
    const riskFactors: string[] = [];
    
    for (const cap of matched) {
      riskFactors.push(...cap.risks);
    }
    
    if (missing.length > 0) {
      riskFactors.push(`Missing capabilities: ${missing.join(", ")}`);
    }
    
    capabilityRisk = {
      allAvailable: missing.length === 0,
      missing,
      riskFactors
    };
    
    if (missing.length > 0) {
      for (const stage of graph.stages) {
        stageRisks.set(stage.id, {
          stageId: stage.id,
          risk: "high",
          factors: [`Missing required capabilities: ${missing.join(", ")}`]
        });
      }
    }
  }
  
  // Determine candidate source kind
  if (graph.family === "patch-validation") {
    if (graph.inputs.patchFilePath) {
      candidateSourceKind = "patchFile";
    } else if (graph.inputs.candidateBranch) {
      candidateSourceKind = "branch";
    }
    
    if (graph.inputs.approvalRequired === true) {
      approvalRequired = true;
    }
  } else if (graph.family === "pr-review-merge") {
    candidateSourceKind = "pr";
  }
  
  // Analyze verification breadth
  const verificationCommands = graph.inputs.verificationCommands as string[] | undefined;
  const reproduceCommands = graph.inputs.reproduceCommands as string[] | undefined;
  
  const totalCommands = (verificationCommands?.length || 0) + (reproduceCommands?.length || 0);
  let verificationBreadth: "narrow" | "moderate" | "comprehensive";
  
  if (totalCommands === 0) {
    verificationBreadth = "narrow";
  } else if (totalCommands <= 2) {
    verificationBreadth = "moderate";
  } else {
    verificationBreadth = "comprehensive";
  }
  
  // Analyze each stage
  for (const stage of graph.stages) {
    const factors: string[] = [];
    let risk: RiskLevel = "low";
    
    const isCapabilityStage = stage.id.startsWith("capability-");
    
    if (isCapabilityStage && capabilityRisk) {
      if (stage.type === "verify") {
        risk = capabilityRisk.allAvailable ? "low" : "medium";
        factors.push(capabilityRisk.allAvailable ? "All capabilities verified" : "Some capabilities missing");
      } else if (stage.type === "review") {
        risk = capabilityRisk.allAvailable ? "low" : "medium";
        factors.push(...capabilityRisk.riskFactors.slice(0, 2));
      } else if (stage.type === "approval") {
        risk = "low";
        factors.push("Human gate prevents automatic progression");
      } else if (stage.type === "setup") {
        risk = "low";
        factors.push("Capability verification setup");
      }
    } else if (stage.type === "reproduce" || stage.type === "verify") {
      if (verificationBreadth === "narrow") {
        risk = "medium";
        factors.push("Limited test coverage");
      } else if (verificationBreadth === "moderate") {
        risk = "low";
        factors.push("Moderate test coverage");
      } else {
        risk = "low";
        factors.push("Comprehensive test coverage");
      }
    } else if (stage.type === "apply") {
      if (candidateSourceKind === "patchFile") {
        risk = "medium";
        factors.push("Patch file may not apply cleanly");
      } else {
        risk = "low";
        factors.push("Branch-based candidate");
      }
    } else if (stage.type === "merge") {
      risk = "medium";
      factors.push("Merge operation modifies target branch");
    } else if (stage.type === "approval") {
      risk = "low";
      factors.push("Human gate prevents automatic progression");
    }
    
    stageRisks.set(stage.id, { stageId: stage.id, risk, factors });
  }
  
  // Determine overall risk
  let overallRisk: RiskLevel = "low";
  for (const stageRisk of stageRisks.values()) {
    if (stageRisk.risk === "high") {
      overallRisk = "high";
      break;
    } else if (stageRisk.risk === "medium") {
      overallRisk = "medium";
    }
  }
  
  // Generate mitigations
  const mitigations: string[] = [];
  
  if (verificationBreadth === "narrow") {
    mitigations.push("Consider adding more verification commands for better coverage");
  }
  
  if (candidateSourceKind === "patchFile") {
    mitigations.push("Patch application failures will be handled gracefully");
  }
  
  if (!approvalRequired && graph.family === "patch-validation") {
    mitigations.push("Consider setting approvalRequired: true for production changes");
  }
  
  return {
    overallRisk,
    approvalRequired,
    candidateSourceKind,
    verificationBreadth,
    stageRisks,
    mitigations,
    capabilityRisk
  };
}
