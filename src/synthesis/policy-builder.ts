import type { LocalPatchValidationBundle, LocalPrBundle, LocalCandidateSource } from "../reference/types.js";
import type { TaskGraph } from "./graph-builder.js";
import type { RiskModel } from "./risk-analyzer.js";

export interface PolicyBundle {
  workflow: string;
  bundle: LocalPatchValidationBundle | LocalPrBundle | Record<string, unknown>;
  rationale: string[];
  warnings: string[];
  missingFields: string[];
}

export type PolicyResult = 
  | { success: true; policy: PolicyBundle }
  | { success: false; reasons: string[]; missingFields: string[]; guidance: string[] };

export function synthesizePolicy(graph: TaskGraph, risks: RiskModel): PolicyResult {
  const missingFields: string[] = [];
  const warnings: string[] = [];
  const rationale: string[] = [];
  
  // Add risk-based warnings
  if (risks.mitigations.length > 0) {
    warnings.push(...risks.mitigations);
  }
  
  const hasSteps = graph.stages.some(s => s.id.startsWith("step-"));
  
  if (hasSteps) {
    rationale.push(
      `Workflow includes ${graph.stages.filter(s => s.id.startsWith("step-")).length} custom step(s)`,
      `Risk level: ${risks.overallRisk}`
    );

    if (graph.family === "patch-validation") {
      if (!graph.inputs.repoPath) missingFields.push("repoPath");
      if (!graph.inputs.baselineRef) missingFields.push("baselineRef");

      const hasCandidateBranch = graph.inputs.candidateBranch && (graph.inputs.candidateBranch as string).length > 0;
      const hasPatchFile = graph.inputs.patchFilePath && (graph.inputs.patchFilePath as string).length > 0;

      if (!hasCandidateBranch && !hasPatchFile) {
        missingFields.push("candidateSource (branch or patchFile)");
      }

      if (missingFields.length > 0) {
        return {
          success: false,
          reasons: [`Patch validation with steps requires: ${missingFields.join(", ")}`],
          missingFields,
          guidance: [
            "For patch-validation with custom steps, provide:",
            "- repoPath",
            "- baselineRef",
            "- candidateSource (branch or .patch file path)"
          ]
        };
      }

      const candidateSource: LocalCandidateSource = hasPatchFile
        ? { kind: "patchFile", value: graph.inputs.patchFilePath as string }
        : { kind: "branch", value: graph.inputs.candidateBranch as string };

      const bundle: LocalPatchValidationBundle = {
        repoPath: graph.inputs.repoPath as string,
        baselineRef: graph.inputs.baselineRef as string,
        candidateSource,
        reproduceCommands: (graph.inputs.reproduceCommands as string[]) || [],
        verificationCommands: (graph.inputs.verificationCommands as string[]) || [],
        reviewInstructions: (graph.inputs.reviewInstructions as string) || "",
        approvalRequired: risks.approvalRequired
      };

      rationale.push(`Classified as patch-validation with custom steps`);

      return {
        success: true,
        policy: {
          workflow: "patch-validation",
          bundle,
          rationale,
          warnings,
          missingFields: []
        }
      };
    } else if (graph.family === "pr-review-merge") {
      if (!graph.inputs.repoPath) missingFields.push("repoPath");
      if (!graph.inputs.sourceBranch) missingFields.push("sourceBranch");
      if (!graph.inputs.targetBranch) missingFields.push("targetBranch");

      if (missingFields.length > 0) {
        return {
          success: false,
          reasons: [`PR review/merge with steps requires: ${missingFields.join(", ")}`],
          missingFields,
          guidance: [
            "For pr-review-merge with custom steps, provide:",
            "- repoPath (absolute path)",
            "- sourceBranch",
            "- targetBranch"
          ]
        };
      }

      const bundle: LocalPrBundle = {
        repoPath: graph.inputs.repoPath as string,
        sourceBranch: graph.inputs.sourceBranch as string,
        targetBranch: graph.inputs.targetBranch as string,
        reviewInstructions: (graph.inputs.reviewInstructions as string) || "",
        verificationCommands: (graph.inputs.verificationCommands as string[]) || []
      };

      rationale.push(`Classified as pr-review-merge with custom steps`);

      return {
        success: true,
        policy: {
          workflow: "pr-review-merge",
          bundle,
          rationale,
          warnings,
          missingFields: []
        }
      };
    }
  }
  
  if (graph.family === "patch-validation") {
    // Validate required fields
    if (!graph.inputs.repoPath) missingFields.push("repoPath");
    if (!graph.inputs.baselineRef) missingFields.push("baselineRef");
    if (!graph.inputs.reviewInstructions) missingFields.push("reviewInstructions");
    
    const hasCandidateBranch = graph.inputs.candidateBranch && (graph.inputs.candidateBranch as string).length > 0;
    const hasPatchFile = graph.inputs.patchFilePath && (graph.inputs.patchFilePath as string).length > 0;
    
    if (!hasCandidateBranch && !hasPatchFile) {
      missingFields.push("candidateSource (branch or patchFile)");
    }
    
    if (!graph.inputs.reproduceCommands || (graph.inputs.reproduceCommands as string[]).length === 0) {
      missingFields.push("reproduceCommands");
    }
    
    if (!graph.inputs.verificationCommands || (graph.inputs.verificationCommands as string[]).length === 0) {
      missingFields.push("verificationCommands");
    }
    
    if (missingFields.length > 0) {
      return {
        success: false,
        reasons: [`Patch validation requires: ${missingFields.join(", ")}`],
        missingFields,
        guidance: [
          "For patch-validation, provide:",
          "- repoPath",
          "- baselineRef",
          "- candidateSource (branch or .patch file path)",
          "- reproduceCommands (should fail on baseline)",
          "- verificationCommands (should still pass after fix)",
          "- reviewInstructions"
        ]
      };
    }
    
    // Build candidate source
    const candidateSource: LocalCandidateSource = hasPatchFile
      ? { kind: "patchFile", value: graph.inputs.patchFilePath as string }
      : { kind: "branch", value: graph.inputs.candidateBranch as string };
    
    // Determine approval requirement from risks or explicit input
    const approvalRequired = risks.approvalRequired;
    
    const bundle: LocalPatchValidationBundle = {
      repoPath: graph.inputs.repoPath as string,
      baselineRef: graph.inputs.baselineRef as string,
      candidateSource,
      reproduceCommands: graph.inputs.reproduceCommands as string[],
      verificationCommands: graph.inputs.verificationCommands as string[],
      reviewInstructions: graph.inputs.reviewInstructions as string,
      approvalRequired
    };
    
    if (!risks.approvalRequired) {
      warnings.push("approvalRequired not specified; defaulting to false");
    }
    
    const candidateDesc = candidateSource.kind === "patchFile" 
      ? `patch file: ${candidateSource.value}` 
      : `candidate branch: ${candidateSource.value}`;
    
    rationale.push(
      `Classified as patch-validation workflow`,
      `Baseline: ${graph.inputs.baselineRef}`,
      `Candidate: ${candidateDesc}`,
      `Reproduce: ${(graph.inputs.reproduceCommands as string[]).length} command(s)`,
      `Verify: ${(graph.inputs.verificationCommands as string[]).length} command(s)`,
      `Approval required: ${approvalRequired}`,
      `Risk level: ${risks.overallRisk}`
    );
    
    return {
      success: true,
      policy: {
        workflow: "patch-validation",
        bundle,
        rationale,
        warnings,
        missingFields: []
      }
    };
  } else if (graph.family === "pr-review-merge") {
    // Validate required fields
    if (!graph.inputs.repoPath) missingFields.push("repoPath");
    if (!graph.inputs.sourceBranch) missingFields.push("sourceBranch");
    if (!graph.inputs.targetBranch) missingFields.push("targetBranch");
    if (!graph.inputs.reviewInstructions) missingFields.push("reviewInstructions");
    if (!graph.inputs.verificationCommands || (graph.inputs.verificationCommands as string[]).length === 0) {
      missingFields.push("verificationCommands");
    }
    
    if (missingFields.length > 0) {
      return {
        success: false,
        reasons: [`PR review/merge requires: ${missingFields.join(", ")}`],
        missingFields,
        guidance: [
          "For pr-review-merge, provide:",
          "- repoPath (absolute path)",
          "- sourceBranch",
          "- targetBranch",
          "- reviewInstructions",
          "- verificationCommands (array of test commands)"
        ]
      };
    }
    
    const bundle: LocalPrBundle = {
      repoPath: graph.inputs.repoPath as string,
      sourceBranch: graph.inputs.sourceBranch as string,
      targetBranch: graph.inputs.targetBranch as string,
      reviewInstructions: graph.inputs.reviewInstructions as string,
      verificationCommands: graph.inputs.verificationCommands as string[]
    };
    
    rationale.push(
      `Classified as pr-review-merge workflow`,
      `Source branch: ${graph.inputs.sourceBranch}`,
      `Target branch: ${graph.inputs.targetBranch}`,
      `Verification: ${(graph.inputs.verificationCommands as string[]).length} command(s)`,
      `Risk level: ${risks.overallRisk}`
    );
    
    return {
      success: true,
      policy: {
        workflow: "pr-review-merge",
        bundle,
        rationale,
        warnings,
        missingFields: []
      }
    };
  }
  
  // Generic fallback for custom workflow families
  rationale.push(
    `Classified as custom workflow: ${graph.family}`,
    `Risk level: ${risks.overallRisk}`
  );

  if (graph.stages.length > 0) {
    rationale.push(`Workflow has ${graph.stages.length} stage(s)`);
  }

  const bundle: Record<string, unknown> = { ...graph.inputs };

  return {
    success: true,
    policy: {
      workflow: graph.family,
      bundle,
      rationale,
      warnings,
      missingFields: []
    }
  };
}
