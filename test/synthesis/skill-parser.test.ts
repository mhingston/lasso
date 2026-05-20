import { describe, it, expect } from "vitest";
import { parsePromptOrSkill, parseSkillMarkdown } from "../../src/synthesis/skill-parser.js";

describe("skill-parser", () => {
  describe("parsePromptOrSkill", () => {
    describe("freeform PR review brief", () => {
      it("should parse a complete PR review brief", () => {
        const brief = `
          Review the PR from feature-branch to main
          repoPath: /path/to/repo
          sourceBranch: feature-branch
          targetBranch: main
          reviewInstructions: "Check for security issues"
          verification commands: [npm test, npm run lint]
        `;
        
        const result = parsePromptOrSkill(brief);
        
        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.family).toBe("pr-review-merge");
          expect(result.intent.inputs.repoPath).toBe("/path/to/repo");
          expect(result.intent.inputs.sourceBranch).toBe("feature-branch");
          expect(result.intent.inputs.targetBranch).toBe("main");
          expect(result.intent.verificationTargets).toHaveLength(2);
        }
      });
    });
    
    describe("freeform patch-validation brief", () => {
      it("should parse a patch validation brief with branch", () => {
        const brief = `
          Validate the patch for baseline v1.0.0
          repoPath: /path/to/repo
          baseline: v1.0.0
          candidate branch: fix-branch
          reproduce commands: [npm run fail-test]
          verification commands: [npm test]
          reviewInstructions: "Ensure the fix works"
        `;
        
        const result = parsePromptOrSkill(brief);
        
        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.family).toBe("patch-validation");
          expect(result.intent.inputs.baselineRef).toBe("v1.0.0");
          expect(result.intent.inputs.candidateBranch).toBe("fix-branch");
        }
      });
      
      it("should parse a patch validation brief with patch file", () => {
        const brief = `
          Validate the patch file fix.patch against baseline main
          repoPath: /path/to/repo
          baseline: main
          patchFile: fix.patch
          reproduce: [node test-fail.js]
          verify: [npm test]
          reviewInstructions: "Check if bug is fixed"
        `;
        
        const result = parsePromptOrSkill(brief);
        
        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.family).toBe("patch-validation");
          expect(result.intent.inputs.patchFilePath).toBe("fix.patch");
        }
      });
      
      it("should include approval checkpoint when approvalRequired is true", () => {
        const brief = `
          patch validation with approval required
          repoPath: /path/to/repo
          baseline: main
          candidate branch: fix-branch
          reproduce: [npm run fail]
          verify: [npm test]
          reviewInstructions: "Validate fix"
          approvalRequired: true
        `;
        
        const result = parsePromptOrSkill(brief);
        
        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.humanCheckpoints).toContain("approval-gate");
        }
      });
    });
    
    describe("skill-markdown input", () => {
      it("should parse skill markdown for PR review", () => {
        const skillMd = `
# PR Review Workflow

workflow: pr-review-merge

## Inputs
- repoPath: /path/to/repo
- sourceBranch: feature
- targetBranch: main
- reviewInstructions: Check code quality

## Verification
- npm test
- npm run lint
        `;
        
        const result = parsePromptOrSkill(skillMd);
        
        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.family).toBe("pr-review-merge");
          expect(result.intent.inputs.repoPath).toBe("/path/to/repo");
          expect(result.intent.inputs.sourceBranch).toBe("feature");
          expect(result.intent.verificationTargets).toHaveLength(2);
        }
      });
      
      it("should parse skill markdown for patch validation", () => {
        const skillMd = `
# Patch Validation Workflow

workflow: patch-validation

## Inputs
- repoPath: /path/to/repo
- baselineRef: v1.0.0
- candidateBranch: fix-branch
- reproduceCommands: [npm run fail-test]
- reviewInstructions: Validate the fix

## Verification
- npm test
- npm run integration
        `;
        
        const result = parsePromptOrSkill(skillMd);
        
        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.family).toBe("patch-validation");
          expect(result.intent.inputs.baselineRef).toBe("v1.0.0");
        }
      });
    });
    
    describe("unsupported/underspecified cases", () => {
      it("should reject empty input", () => {
        const result = parsePromptOrSkill("");
        
        expect(result).toHaveProperty("rejected", true);
        if ("rejected" in result) {
          expect(result.reasons).toContain("Input is empty");
        }
      });
      
      it("should reject ambiguous input", () => {
        const brief = "Do something with a repository at /path/to/repo";
        
        const result = parsePromptOrSkill(brief);
        
        expect(result).toHaveProperty("rejected", true);
        if ("rejected" in result) {
          expect(result.reasons.some(r => r.includes("Could not determine workflow type"))).toBe(true);
        }
      });
      
      it("should reject input that mentions unsupported workflow", () => {
        const brief = `
          workflow: deploy-to-production
          repoPath: /path/to/repo
        `;
        
        const result = parsePromptOrSkill(brief);
        
        // This should be ambiguous since 'deploy-to-production' doesn't match our indicators
        expect(result).toHaveProperty("rejected", true);
      });
    });
  });
  
  describe("parseSkillMarkdown", () => {
    it("should extract title from markdown", () => {
      const md = `# My Workflow Title`;
      const skill = parseSkillMarkdown(md);
      expect(skill.title).toBe("My Workflow Title");
    });
    
    it("should extract workflow type", () => {
      const md = `workflow: patch-validation`;
      const skill = parseSkillMarkdown(md);
      expect(skill.workflow).toBe("patch-validation");
    });
    
    it("should extract inputs section", () => {
      const md = `
## Inputs
- repoPath: /path/to/repo
- branch: main
      `;
      const skill = parseSkillMarkdown(md);
      expect(skill.inputs).toEqual({
        repoPath: "/path/to/repo",
        branch: "main"
      });
    });
  });
});
