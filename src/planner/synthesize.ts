import type { ReferenceWorkflowRequest } from "../reference/catalog.js";
import type { LocalPrBundle, LocalPatchValidationBundle } from "../reference/types.js";
import { extractFields } from "./template-rules.js";
import type { PlannerResult } from "./types.js";

export function planWorkflowRequest(brief: string): PlannerResult {
  // Reject empty briefs
  if (!brief || brief.trim().length === 0) {
    return {
      status: "needs_clarification",
      reasons: ["Brief is empty"],
      missingFields: ["brief"],
      guidance: [
        "Please provide a workflow description including repo path, workflow type (PR review/merge or patch validation), and required commands."
      ]
    };
  }
  
  const extracted = extractFields(brief);
  
  // Handle ambiguous classification
  if (extracted.template === "ambiguous") {
    return {
      status: "needs_clarification",
      reasons: ["Could not determine workflow type - brief matches multiple or no workflow patterns"],
      missingFields: ["workflow type"],
      guidance: [
        "Please clearly specify either:",
        "(1) PR review/merge with source and target branches, or",
        "(2) Patch validation with baseline ref and candidate source."
      ]
    };
  }
  
  // Validate and build PR review/merge request
  if (extracted.template === "pr-review-merge") {
    const missingFields: string[] = [];
    const warnings: string[] = [];
    
    if (!extracted.repoPath) missingFields.push("repoPath");
    if (!extracted.sourceBranch) missingFields.push("sourceBranch");
    if (!extracted.targetBranch) missingFields.push("targetBranch");
    if (!extracted.reviewInstructions) missingFields.push("reviewInstructions");
    if (!extracted.verificationCommands || extracted.verificationCommands.length === 0) {
      missingFields.push("verificationCommands");
    }
    
    if (missingFields.length > 0) {
      return {
        status: "needs_clarification",
        candidateWorkflow: "pr-review-merge",
        reasons: [`PR review/merge workflow requires: ${missingFields.join(", ")}`],
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
    
    const prBundle: LocalPrBundle = {
      repoPath: extracted.repoPath!,
      sourceBranch: extracted.sourceBranch!,
      targetBranch: extracted.targetBranch!,
      reviewInstructions: extracted.reviewInstructions!,
      verificationCommands: extracted.verificationCommands!
    };
    
    const request: ReferenceWorkflowRequest = {
      workflow: "pr-review-merge",
      input: prBundle
    };
    
    return { 
      status: "draft_request", 
      workflow: "pr-review-merge",
      request,
      rationale: [
        `Classified as pr-review-merge workflow`,
        `Source branch: ${extracted.sourceBranch}`,
        `Target branch: ${extracted.targetBranch}`,
        `Verification: ${extracted.verificationCommands!.length} command(s)`
      ],
      warnings
    };
  }
  
  // Validate and build patch validation request
  if (extracted.template === "patch-validation") {
    const missingFields: string[] = [];
    const warnings: string[] = [];
    
    if (!extracted.repoPath) missingFields.push("repoPath");
    if (!extracted.baselineRef) missingFields.push("baselineRef");
    if (!extracted.reviewInstructions) missingFields.push("reviewInstructions");
    
    // Candidate must be either branch or patch file
    const hasCandidateBranch = extracted.candidateBranch && extracted.candidateBranch.length > 0;
    const hasPatchFile = extracted.patchFilePath && extracted.patchFilePath.length > 0;
    
    if (!hasCandidateBranch && !hasPatchFile) {
      missingFields.push("candidateSource (branch or patchFile)");
    }
    
    if (!extracted.reproduceCommands || extracted.reproduceCommands.length === 0) {
      missingFields.push("reproduceCommands");
    }
    
    if (!extracted.verificationCommands || extracted.verificationCommands.length === 0) {
      missingFields.push("verificationCommands");
    }
    
    if (missingFields.length > 0) {
      return {
        status: "needs_clarification",
        candidateWorkflow: "patch-validation",
        reasons: [`Patch validation workflow requires: ${missingFields.join(", ")}`],
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
    
    // Determine candidate source
    const candidateSource = hasPatchFile
      ? { kind: "patchFile" as const, value: extracted.patchFilePath! }
      : { kind: "branch" as const, value: extracted.candidateBranch! };
    
    // Determine approval requirement: defaults to false when not explicitly set
    const approvalRequired = extracted.approvalRequired ?? false;
    
    const patchBundle: LocalPatchValidationBundle = {
      repoPath: extracted.repoPath!,
      baselineRef: extracted.baselineRef!,
      candidateSource,
      reproduceCommands: extracted.reproduceCommands!,
      verificationCommands: extracted.verificationCommands!,
      reviewInstructions: extracted.reviewInstructions!,
      approvalRequired
    };
    
    const request: ReferenceWorkflowRequest = {
      workflow: "patch-validation",
      input: patchBundle
    };
    
    if (extracted.approvalRequired === undefined) {
      warnings.push("approvalRequired not specified; defaulting to false");
    }
    
    const candidateDesc = candidateSource.kind === "patchFile" 
      ? `patch file: ${candidateSource.value}` 
      : `candidate branch: ${candidateSource.value}`;
    
    return { 
      status: "draft_request", 
      workflow: "patch-validation",
      request,
      rationale: [
        `Classified as patch-validation workflow`,
        `Baseline: ${extracted.baselineRef}`,
        `Candidate: ${candidateDesc}`,
        `Reproduce: ${extracted.reproduceCommands!.length} command(s)`,
        `Verify: ${extracted.verificationCommands!.length} command(s)`,
        `Approval required: ${approvalRequired}`
      ],
      warnings
    };
  }
  
  // Fallback (should not reach here given the ambiguous check above)
  return {
    status: "needs_clarification",
    reasons: ["Unable to classify workflow template"],
    missingFields: ["workflow type"],
    guidance: [
      "Please specify a clear workflow pattern for either pr-review-merge or patch-validation."
    ]
  };
}
