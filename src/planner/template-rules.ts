import type { ExtractionResult, WorkflowTemplate } from "./types.js";

export function classifyTemplate(brief: string): WorkflowTemplate {
  const lower = brief.toLowerCase();
  
  // Strong PR-specific indicators (without overlap)
  const prIndicators = [
    "pull request",
    "pr review",
    "pr merge",
    " pr ",
    "source branch",
    "target branch"
  ];
  
  // Strong patch-specific indicators
  const patchIndicators = [
    "patch validation",
    ".patch",
    ".diff",
    "baseline",
    "reproduce"
  ];
  
  const hasPrSignals = prIndicators.some(indicator => lower.includes(indicator));
  const hasPatchSignals = patchIndicators.some(indicator => lower.includes(indicator));
  
  // If both or neither, it's ambiguous
  if (hasPrSignals && hasPatchSignals) {
    return "ambiguous";
  }
  
  if (hasPrSignals) {
    return "pr-review-merge";
  }
  
  if (hasPatchSignals) {
    return "patch-validation";
  }
  
  // If no strong signals, it's ambiguous
  return "ambiguous";
}

export function extractFields(brief: string): ExtractionResult {
  const template = classifyTemplate(brief);
  const result: ExtractionResult = { template };
  
  // Extract repo path
  result.repoPath = extractRepoPath(brief);
  
  if (template === "pr-review-merge") {
    result.sourceBranch = extractField(brief, ["source branch", "sourceBranch", "source:", "from branch"]);
    result.targetBranch = extractField(brief, ["target branch", "targetBranch", "target:", "to branch", "into branch"]);
    result.verificationCommands = extractCommands(brief, ["verification", "verify", "test"]);
    result.reviewInstructions = extractReviewInstructions(brief);
  } else if (template === "patch-validation") {
    result.baselineRef = extractField(brief, ["baseline", "baselineRef", "base:", "baseline:"]);
    result.candidateBranch = extractField(brief, ["candidate branch", "candidateBranch", "candidate:", "fix branch"]);
    result.patchFilePath = extractPatchFile(brief);
    result.reproduceCommands = extractCommands(brief, ["reproduce", "repro"]);
    result.verificationCommands = extractCommands(brief, ["verification", "verify", "test"]);
    result.reviewInstructions = extractReviewInstructions(brief);
    result.approvalRequired = extractApprovalFlag(brief);
  }
  
  return result;
}

function extractRepoPath(brief: string): string | undefined {
  // Look for explicit repo path patterns
  const patterns = [
    /repoPath:\s*["']?([^"'\s\n]+)["']?/i,
    /repo:\s*["']?([^"'\s\n]+)["']?/i,
    /repository:\s*["']?([^"'\s\n]+)["']?/i,
    /path:\s*["']?(\/[^"'\s\n]+)["']?/i  // Absolute path starting with /
  ];
  
  for (const pattern of patterns) {
    const match = brief.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return undefined;
}

function extractField(brief: string, keywords: string[]): string | undefined {
  for (const keyword of keywords) {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escapedKeyword}\\s*[:\\s]+["']?([^"'\\s\\n,;]+)["']?`, "i");
    const match = brief.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

function extractPatchFile(brief: string): string | undefined {
  // Look for .patch or .diff file mentions
  const patchPattern = /["']?([^\s"']+\.(?:patch|diff))["']?/i;
  const match = brief.match(patchPattern);
  if (match && match[1]) {
    return match[1].trim();
  }
  return undefined;
}

function extractCommands(brief: string, keywords: string[]): string[] | undefined {
  const commandsSet = new Set<string>();
  
  for (const keyword of keywords) {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Look for commands after keyword with various formats
    const patterns = [
      new RegExp(`${escapedKeyword}\\s+commands?:\\s*\\[([^\\]]+)\\]`, "i"),
      new RegExp(`${escapedKeyword}\\s+commands?:\\s*["']([^"']+)["']`, "i"),
      new RegExp(`${escapedKeyword}:\\s*\\[([^\\]]+)\\]`, "i")
    ];
    
    for (const pattern of patterns) {
      const match = brief.match(pattern);
      if (match && match[1]) {
        const cmdList = match[1]
          .split(/,\s*/)
          .map(cmd => cmd.trim().replace(/^["']|["']$/g, ''))
          .filter(cmd => cmd.length > 0);
        cmdList.forEach(cmd => commandsSet.add(cmd));
      }
    }
  }
  
  const commands = Array.from(commandsSet);
  return commands.length > 0 ? commands : undefined;
}

function extractReviewInstructions(brief: string): string | undefined {
  const patterns = [
    /reviewInstructions:\s*["']([^"']+)["']/i,
    /review instructions:\s*["']([^"']+)["']/i,
    /instructions:\s*["']([^"']+)["']/i
  ];
  
  for (const pattern of patterns) {
    const match = brief.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  // If not explicitly provided, use a generic fallback only if we have other fields
  return undefined;
}

function extractApprovalFlag(brief: string): boolean | undefined {
  const lower = brief.toLowerCase();
  
  // Explicit approval signals (case insensitive)
  if (
    lower.includes("approval required") || 
    lower.includes("approvalrequired: true") || 
    lower.includes("needs approval")
  ) {
    return true;
  }
  
  // Explicit no-approval signals
  if (
    lower.includes("no approval") || 
    lower.includes("approvalrequired: false") || 
    lower.includes("auto approve")
  ) {
    return false;
  }
  
  // Default: undefined (let synthesize determine based on template)
  return undefined;
}
