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

function normalizeInputValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmedValue = value.trim();
  
  // Normalize array-like strings: "[npm test, npm run lint]" -> ["npm test", "npm run lint"]
  // Handle empty arrays: "[]" -> []
  const arrayMatch = trimmedValue.match(/^\[(.*)\]$/);
  if (arrayMatch) {
    const content = arrayMatch[1].trim();
    
    // Handle empty array
    if (content.length === 0) {
      return [];
    }
    
    // Parse array with quote-aware splitting
    return parseQuotedArray(content);
  }
  
  // Normalize boolean-like strings: "true" -> true, "false" -> false
  if (trimmedValue.toLowerCase() === "true") {
    return true;
  }
  if (trimmedValue.toLowerCase() === "false") {
    return false;
  }
  
  return trimmedValue.replace(/^["']|["']$/g, "");
}

/**
 * Parse a comma-separated string while respecting quoted strings.
 * Handles both single and double quotes.
 * Examples:
 *   "a, b, c" -> ["a", "b", "c"]
 *   '"echo hello", "npm test"' -> ["echo hello", "npm test"]
 *   '"echo \'hello, world\'", npm test' -> ["echo 'hello, world'", "npm test"]
 */
function parseQuotedArray(content: string): string[] {
  const items: string[] = [];
  let current = "";
  let inQuote: "'" | '"' | null = null;
  let escaped = false;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    
    if (escaped) {
      // Handle escaped character - convert \\ and \" / \' to actual characters
      if (char === '"' || char === "'" || char === "\\") {
        current += char;
      } else {
        current += "\\" + char;
      }
      escaped = false;
      continue;
    }
    
    if (char === "\\") {
      escaped = true;
      continue;
    }
    
    if (char === '"' || char === "'") {
      if (inQuote === null) {
        // Starting a quoted string
        inQuote = char;
        current += char;
      } else if (inQuote === char) {
        // Ending the current quoted string
        current += char;
        inQuote = null;
      } else {
        // Different quote type inside current quote
        current += char;
      }
      continue;
    }
    
    if (char === "," && inQuote === null) {
      // Split point - not inside quotes
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        // Remove outer quotes if present
        items.push(trimmed.replace(/^["']|["']$/g, ''));
      }
      current = "";
      continue;
    }
    
    current += char;
  }
  
  // Add the last item
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    items.push(trimmed.replace(/^["']|["']$/g, ''));
  }
  
  return items.filter(item => item.length > 0);
}

/**
 * Normalize skill inputs and merge verification targets into verificationCommands.
 * This logic is shared between PR review and patch validation workflows.
 */
function normalizeAndMergeVerification(
  skill: SkillMarkdown
): { normalizedInputs: Record<string, unknown>; verificationCommands: string[] } {
  const normalizedInputs: Record<string, unknown> = {};
  
  // Normalize all inputs
  if (skill.inputs) {
    for (const [key, value] of Object.entries(skill.inputs)) {
      normalizedInputs[key] = normalizeInputValue(value);
    }
  }

  for (const commandKey of ["reproduceCommands", "verificationCommands"] as const) {
    const commandValue = normalizedInputs[commandKey];
    if (typeof commandValue === "string") {
      normalizedInputs[commandKey] = [commandValue];
    }
  }
  
  // Merge verification targets into verificationCommands
  let verificationCommands = normalizedInputs.verificationCommands as string[] | undefined;
  if (skill.verificationTargets && skill.verificationTargets.length > 0) {
    if (!verificationCommands) {
      verificationCommands = [];
    } else if (!Array.isArray(verificationCommands)) {
      // Shouldn't happen after normalization, but guard anyway
      verificationCommands = [];
    }
    verificationCommands = [...new Set([...verificationCommands, ...skill.verificationTargets])];
    normalizedInputs.verificationCommands = verificationCommands;
  }
  
  return {
    normalizedInputs,
    verificationCommands: verificationCommands || skill.verificationTargets || []
  };
}

function skillMarkdownToIntentIR(skill: SkillMarkdown): IntentParseResult {
  // If workflow is explicitly specified, use it directly if supported
  if (skill.workflow) {
    const lowerWorkflow = skill.workflow.toLowerCase();
    if (lowerWorkflow === "pr-review-merge" || lowerWorkflow.includes("pr") || lowerWorkflow.includes("pull request")) {
      const { normalizedInputs, verificationCommands } = normalizeAndMergeVerification(skill);
      
      const intent: IntentIR = {
        family: "pr-review-merge",
        goal: "Review and merge PR",
        inputs: normalizedInputs,
        requiredTools: ["git"],
        humanCheckpoints: [],
        verificationTargets: verificationCommands
      };
      
      const validation = validateIntent(intent);
      if (validation) {
        return validation;
      }
      
      return { success: true, intent };
    } else if (lowerWorkflow === "patch-validation" || lowerWorkflow.includes("patch") || lowerWorkflow.includes("validation")) {
      const { normalizedInputs, verificationCommands } = normalizeAndMergeVerification(skill);
      
      const intent: IntentIR = {
        family: "patch-validation",
        goal: "Validate patch against baseline",
        inputs: normalizedInputs,
        requiredTools: ["git"],
        humanCheckpoints: [],
        verificationTargets: verificationCommands
      };
      
      if (normalizedInputs.approvalRequired === true) {
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
