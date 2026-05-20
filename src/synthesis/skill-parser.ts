import type { ExtractionResult } from "../planner/types.js";
import { extractFields } from "../planner/template-rules.js";
import type { IntentIR, IntentParseResult, SupportedWorkflowFamily } from "./intent-ir.js";
import { rejectUnsupportedIntent, validateIntent } from "./intent-ir.js";

export interface SkillMarkdown {
  title?: string;
  workflow?: string;
  inputs?: Record<string, unknown>;
  steps?: string[];
  verificationTargets?: string[];
}

export function parseSkillMarkdown(markdown: string): SkillMarkdown {
  const skill: SkillMarkdown = {};
  
  // Extract title from first # heading
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    skill.title = titleMatch[1].trim();
  }
  
  // Extract workflow type
  const workflowMatch = markdown.match(/workflow:\s*(.+)/i);
  if (workflowMatch) {
    skill.workflow = workflowMatch[1].trim();
  }
  
  // Extract inputs section
  const inputsMatch = markdown.match(/##\s*inputs?\s*\n(.*?)(?=\n##|\n\n#|$)/is);
  if (inputsMatch) {
    skill.inputs = {};
    const inputLines = inputsMatch[1].match(/^[-*]\s*(.+)$/gm);
    if (inputLines) {
      for (const line of inputLines) {
        const cleanLine = line.replace(/^[-*]\s*/, "").trim();
        const colonIndex = cleanLine.indexOf(":");
        if (colonIndex > 0) {
          const key = cleanLine.substring(0, colonIndex).trim();
          const value = cleanLine.substring(colonIndex + 1).trim();
          skill.inputs[key] = value;
        }
      }
    }
  }
  
  // Extract steps
  const stepsMatch = markdown.match(/##\s*steps?\s*\n(.*?)(?=\n##|\n\n#|$)/is);
  if (stepsMatch) {
    const stepLines = stepsMatch[1].match(/^[-*]\s*(.+)$/gm);
    if (stepLines) {
      skill.steps = stepLines.map(line => line.replace(/^[-*]\s*/, "").trim());
    }
  }
  
  // Extract verification targets
  const verificationMatch = markdown.match(/##\s*verification\s*\n(.*?)(?=\n##|\n\n#|$)/is);
  if (verificationMatch) {
    const verifyLines = verificationMatch[1].match(/^[-*]\s*(.+)$/gm);
    if (verifyLines) {
      skill.verificationTargets = verifyLines.map(line => line.replace(/^[-*]\s*/, "").trim());
    }
  }
  
  return skill;
}

function extractionResultToIntentIR(extracted: ExtractionResult): IntentParseResult {
  if (extracted.template === "ambiguous") {
    return rejectUnsupportedIntent(
      ["Could not determine workflow type - brief matches multiple or no workflow patterns"],
      undefined,
      [
        "Please clearly specify either:",
        "(1) PR review/merge with source and target branches, or",
        "(2) Patch validation with baseline ref and candidate source."
      ]
    );
  }
  
  const family = extracted.template as SupportedWorkflowFamily;
  
  const intent: IntentIR = {
    family,
    goal: family === "pr-review-merge" 
      ? "Review and merge PR" 
      : "Validate patch against baseline",
    inputs: {},
    requiredTools: ["git"],
    humanCheckpoints: [],
    verificationTargets: []
  };
  
  // Map extracted fields to inputs
  if (extracted.repoPath) intent.inputs.repoPath = extracted.repoPath;
  
  if (family === "pr-review-merge") {
    if (extracted.sourceBranch) intent.inputs.sourceBranch = extracted.sourceBranch;
    if (extracted.targetBranch) intent.inputs.targetBranch = extracted.targetBranch;
    if (extracted.reviewInstructions) intent.inputs.reviewInstructions = extracted.reviewInstructions;
    if (extracted.verificationCommands) {
      intent.inputs.verificationCommands = extracted.verificationCommands;
      intent.verificationTargets = extracted.verificationCommands;
    }
  } else if (family === "patch-validation") {
    if (extracted.baselineRef) intent.inputs.baselineRef = extracted.baselineRef;
    if (extracted.candidateBranch) intent.inputs.candidateBranch = extracted.candidateBranch;
    if (extracted.patchFilePath) intent.inputs.patchFilePath = extracted.patchFilePath;
    if (extracted.reproduceCommands) intent.inputs.reproduceCommands = extracted.reproduceCommands;
    if (extracted.verificationCommands) {
      intent.inputs.verificationCommands = extracted.verificationCommands;
      intent.verificationTargets = extracted.verificationCommands;
    }
    if (extracted.reviewInstructions) intent.inputs.reviewInstructions = extracted.reviewInstructions;
    if (extracted.approvalRequired !== undefined) {
      intent.inputs.approvalRequired = extracted.approvalRequired;
      if (extracted.approvalRequired) {
        intent.humanCheckpoints.push("approval-gate");
      }
    }
  }
  
  const validation = validateIntent(intent);
  if (validation) {
    return validation;
  }
  
  return { success: true, intent };
}

function skillMarkdownToIntentIR(skill: SkillMarkdown): IntentParseResult {
  // If workflow is explicitly specified, use it directly if supported
  if (skill.workflow) {
    const lowerWorkflow = skill.workflow.toLowerCase();
    if (lowerWorkflow === "pr-review-merge" || lowerWorkflow.includes("pr") || lowerWorkflow.includes("pull request")) {
      const intent: IntentIR = {
        family: "pr-review-merge",
        goal: "Review and merge PR",
        inputs: skill.inputs || {},
        requiredTools: ["git"],
        humanCheckpoints: [],
        verificationTargets: skill.verificationTargets || []
      };
      
      const validation = validateIntent(intent);
      if (validation) {
        return validation;
      }
      
      return { success: true, intent };
    } else if (lowerWorkflow === "patch-validation" || lowerWorkflow.includes("patch") || lowerWorkflow.includes("validation")) {
      const intent: IntentIR = {
        family: "patch-validation",
        goal: "Validate patch against baseline",
        inputs: skill.inputs || {},
        requiredTools: ["git"],
        humanCheckpoints: [],
        verificationTargets: skill.verificationTargets || []
      };
      
      if (skill.inputs && skill.inputs.approvalRequired === true) {
        intent.humanCheckpoints.push("approval-gate");
      }
      
      const validation = validateIntent(intent);
      if (validation) {
        return validation;
      }
      
      return { success: true, intent };
    }
  }
  
  // Fallback: reconstruct a brief-like string to reuse extraction logic
  const briefParts: string[] = [];
  
  if (skill.workflow) {
    briefParts.push(`workflow: ${skill.workflow}`);
  }
  
  if (skill.inputs) {
    for (const [key, value] of Object.entries(skill.inputs)) {
      briefParts.push(`${key}: ${value}`);
    }
  }
  
  if (skill.verificationTargets && skill.verificationTargets.length > 0) {
    briefParts.push(`verification commands: [${skill.verificationTargets.join(", ")}]`);
  }
  
  const reconstructedBrief = briefParts.join("\n");
  
  // Parse using existing extraction logic
  const extracted = extractFields(reconstructedBrief);
  return extractionResultToIntentIR(extracted);
}

export function parsePromptOrSkill(input: string): IntentParseResult {
  if (!input || input.trim().length === 0) {
    return rejectUnsupportedIntent(
      ["Input is empty"],
      undefined,
      ["Please provide a workflow description"]
    );
  }
  
  // Detect if this is skill markdown (has markdown headings and structure)
  const hasMarkdownStructure = /^#\s+/m.test(input) || /^##\s+/m.test(input);
  
  if (hasMarkdownStructure) {
    const skill = parseSkillMarkdown(input);
    return skillMarkdownToIntentIR(skill);
  }
  
  // Otherwise treat as freeform brief
  const extracted = extractFields(input);
  return extractionResultToIntentIR(extracted);
}
