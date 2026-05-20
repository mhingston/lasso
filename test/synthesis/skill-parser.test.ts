import { describe, it, expect } from "vitest";
import { parsePromptOrSkill, parseSkillMarkdown } from "../../src/synthesis/skill-parser.js";
import { buildTaskGraph } from "../../src/synthesis/graph-builder.js";
import { analyzeRisks } from "../../src/synthesis/risk-analyzer.js";
import { synthesizePolicy } from "../../src/synthesis/policy-builder.js";
import { synthesizeHarness } from "../../src/synthesis/harness-builder.js";

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
      
      it("should normalize array-like inputs in skill markdown for PR review", () => {
        const skillMd = `
# PR Review Workflow

workflow: pr-review-merge

## Inputs
- repoPath: /path/to/repo
- sourceBranch: feature
- targetBranch: main
- reviewInstructions: Check code quality
- verificationCommands: [npm test, npm run lint]

## Verification
- npm run e2e
        `;
        
        const result = parsePromptOrSkill(skillMd);
        
        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.family).toBe("pr-review-merge");
          // verificationCommands should be normalized from string "[npm test, npm run lint]" to array
          expect(result.intent.inputs.verificationCommands).toEqual(["npm test", "npm run lint", "npm run e2e"]);
          // Verification section should merge/append to verificationCommands
          expect(result.intent.verificationTargets).toContain("npm test");
          expect(result.intent.verificationTargets).toContain("npm run lint");
          expect(result.intent.verificationTargets).toContain("npm run e2e");
        }
      });
      
      it("should normalize array-like and boolean inputs in skill markdown for patch validation", () => {
        const skillMd = `
# Patch Validation Workflow

workflow: patch-validation

## Inputs
- repoPath: /path/to/repo
- baselineRef: v1.0.0
- candidateBranch: fix-branch
- reproduceCommands: [npm run fail-test, node reproduce.js]
- verificationCommands: [npm test]
- reviewInstructions: Validate the fix
- approvalRequired: true

## Verification
- npm run integration
        `;
        
        const result = parsePromptOrSkill(skillMd);
        
        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.family).toBe("patch-validation");
          // reproduceCommands should be normalized from string to array
          expect(result.intent.inputs.reproduceCommands).toEqual(["npm run fail-test", "node reproduce.js"]);
          // verificationCommands should include both inputs section and Verification section
          expect(result.intent.inputs.verificationCommands).toEqual(["npm test", "npm run integration"]);
          // approvalRequired should be normalized from string "true" to boolean true
          expect(result.intent.inputs.approvalRequired).toBe(true);
          expect(result.intent.humanCheckpoints).toContain("approval-gate");
        }
      });
      
      it("should populate verificationCommands from Verification section when not in inputs", () => {
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
          // Verification section should populate inputs.verificationCommands
          expect(result.intent.inputs.verificationCommands).toEqual(["npm test", "npm run lint"]);
          expect(result.intent.verificationTargets).toEqual(["npm test", "npm run lint"]);
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
      
      it("should accept ambiguous input as custom workflow", () => {
        const brief = "Do something with a repository at /path/to/repo";
        
        const result = parsePromptOrSkill(brief);
        
        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.family).toBe("custom");
        }
      });
      
      it("should accept unsupported workflow as custom workflow", () => {
        const brief = `
          workflow: deploy-to-production
          repoPath: /path/to/repo
        `;
        
        const result = parsePromptOrSkill(brief);
        
        // Now accepted as a custom workflow family
        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.family).toBe("deploy-to-production");
        }
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
  
  describe("normalizeInputValue edge cases", () => {
    it("should handle commands with commas inside quoted strings", () => {
      const skillMd = `
# PR Review Workflow

workflow: pr-review-merge

## Inputs
- repoPath: /path/to/repo
- sourceBranch: feature
- targetBranch: main
- reviewInstructions: Check code quality
- verificationCommands: ["echo 'hello, world'", "npm test"]
      `;
      
      const result = parsePromptOrSkill(skillMd);
      
      expect(result).toHaveProperty("success", true);
      if ("success" in result && result.success) {
        expect(result.intent.inputs.verificationCommands).toEqual([
          "echo 'hello, world'",
          "npm test"
        ]);
      }
    });
    
    it("should handle commands with commas in double quotes", () => {
      const skillMd = `
# Patch Validation

workflow: patch-validation

## Inputs
- repoPath: /path/to/repo
- baselineRef: main
- candidateBranch: fix
- reproduceCommands: ["node test.js --data 'a, b, c'", "npm run fail"]
- verificationCommands: ["npm test"]
- reviewInstructions: Validate fix
      `;
      
      const result = parsePromptOrSkill(skillMd);
      
      expect(result).toHaveProperty("success", true);
      if ("success" in result && result.success) {
        expect(result.intent.inputs.reproduceCommands).toEqual([
          "node test.js --data 'a, b, c'",
          "npm run fail"
        ]);
      }
    });
    
    it("should normalize empty array string [] to empty array", () => {
      const skillMd = `
# PR Review Workflow

workflow: pr-review-merge

## Inputs
- repoPath: /path/to/repo
- sourceBranch: feature
- targetBranch: main
- reviewInstructions: Check code quality
- verificationCommands: []
      `;
      
      const result = parsePromptOrSkill(skillMd);
      
      expect(result).toHaveProperty("success", true);
      if ("success" in result && result.success) {
        // Should be normalized to an empty array, not remain as string "[]"
        expect(Array.isArray(result.intent.inputs.verificationCommands)).toBe(true);
        expect((result.intent.inputs.verificationCommands as string[]).length).toBe(0);
      }
    });
    
    it("should handle arrays with quoted strings containing brackets", () => {
      const skillMd = `
# Test Workflow

workflow: pr-review-merge

## Inputs
- repoPath: /path/to/repo
- sourceBranch: feature
- targetBranch: main
- reviewInstructions: Check
- verificationCommands: ["echo '[test]'", "npm test"]
      `;
      
      const result = parsePromptOrSkill(skillMd);
      
      expect(result).toHaveProperty("success", true);
      if ("success" in result && result.success) {
        expect(result.intent.inputs.verificationCommands).toEqual([
          "echo '[test]'",
          "npm test"
        ]);
      }
    });

    describe("steps field mapping to IntentIR", () => {
      it("should populate intent.steps from skill markdown steps section", () => {
        const skillMd = `
# Custom Workflow

workflow: patch-validation

## Inputs
- repoPath: /path/to/repo
- baselineRef: main
- candidateBranch: fix
- reproduceCommands: [npm run fail]
- verificationCommands: [npm test]
- reviewInstructions: Validate fix

## Steps
- [tool] Run npm install
- [tool] Apply the patch
- [llm] Summarize changes
- [human] Review the output
        `;

        const result = parsePromptOrSkill(skillMd);

        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.steps).toBeDefined();
          expect(result.intent.steps).toHaveLength(4);
        }
      });

      it("should infer step kind from [tool] prefix", () => {
        const skillMd = `
# Test

workflow: patch-validation

## Inputs
- repoPath: /repo
- baselineRef: main
- candidateBranch: fix
- reproduceCommands: [npm run fail]
- verificationCommands: [npm test]
- reviewInstructions: Check

## Steps
- [tool] npm install
        `;

        const result = parsePromptOrSkill(skillMd);

        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.steps![0].kind).toBe("tool");
          expect(result.intent.steps![0].label).toBe("npm install");
        }
      });

      it("should infer step kind from [llm] prefix", () => {
        const skillMd = `
# Test

workflow: patch-validation

## Inputs
- repoPath: /repo
- baselineRef: main
- candidateBranch: fix
- reproduceCommands: [npm run fail]
- verificationCommands: [npm test]
- reviewInstructions: Check

## Steps
- [llm] Analyze code quality
        `;

        const result = parsePromptOrSkill(skillMd);

        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.steps![0].kind).toBe("llm");
          expect(result.intent.steps![0].label).toBe("Analyze code quality");
        }
      });

      it("should infer step kind from [human] prefix", () => {
        const skillMd = `
# Test

workflow: patch-validation

## Inputs
- repoPath: /repo
- baselineRef: main
- candidateBranch: fix
- reproduceCommands: [npm run fail]
- verificationCommands: [npm test]
- reviewInstructions: Check

## Steps
- [human] Approve changes
        `;

        const result = parsePromptOrSkill(skillMd);

        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.steps![0].kind).toBe("human");
          expect(result.intent.steps![0].label).toBe("Approve changes");
        }
      });

      it("should infer step kind from [condition] prefix", () => {
        const skillMd = `
# Test

workflow: patch-validation

## Inputs
- repoPath: /repo
- baselineRef: main
- candidateBranch: fix
- reproduceCommands: [npm run fail]
- verificationCommands: [npm test]
- reviewInstructions: Check

## Steps
- [condition] Tests passed?
        `;

        const result = parsePromptOrSkill(skillMd);

        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.steps![0].kind).toBe("condition");
        }
      });

      it("should default to tool kind when no prefix is present", () => {
        const skillMd = `
# Test

workflow: patch-validation

## Inputs
- repoPath: /repo
- baselineRef: main
- candidateBranch: fix
- reproduceCommands: [npm run fail]
- verificationCommands: [npm test]
- reviewInstructions: Check

## Steps
- npm install
        `;

        const result = parsePromptOrSkill(skillMd);

        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.steps![0].kind).toBe("tool");
          expect(result.intent.steps![0].label).toBe("npm install");
        }
      });

      it("should preserve step order", () => {
        const skillMd = `
# Test

workflow: patch-validation

## Inputs
- repoPath: /repo
- baselineRef: main
- candidateBranch: fix
- reproduceCommands: [npm run fail]
- verificationCommands: [npm test]
- reviewInstructions: Check

## Steps
- [tool] First step
- [llm] Second step
- [human] Third step
        `;

        const result = parsePromptOrSkill(skillMd);

        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.steps![0].label).toBe("First step");
          expect(result.intent.steps![1].label).toBe("Second step");
          expect(result.intent.steps![2].label).toBe("Third step");
        }
      });

      it("should generate unique step ids from label text", () => {
        const skillMd = `
# Test

workflow: patch-validation

## Inputs
- repoPath: /repo
- baselineRef: main
- candidateBranch: fix
- reproduceCommands: [npm run fail]
- verificationCommands: [npm test]
- reviewInstructions: Check

## Steps
- [tool] Run tests
- [tool] Run linter
        `;

        const result = parsePromptOrSkill(skillMd);

        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.steps![0].id).not.toBe(result.intent.steps![1].id);
        }
      });

      it("should not populate steps when no steps section exists", () => {
        const skillMd = `
# Test

workflow: patch-validation

## Inputs
- repoPath: /repo
- baselineRef: main
- candidateBranch: fix
- reproduceCommands: [npm run fail]
- verificationCommands: [npm test]
- reviewInstructions: Check
        `;

        const result = parsePromptOrSkill(skillMd);

        expect(result).toHaveProperty("success", true);
        if ("success" in result && result.success) {
          expect(result.intent.steps).toBeUndefined();
        }
      });
    });

    it("should normalize single command strings into command arrays", () => {
      const skillMd = `
# Patch Validation

workflow: patch-validation

## Inputs
- repoPath: /path/to/repo
- baselineRef: main
- candidateBranch: fix
- reproduceCommands: "npm run fail"
- verificationCommands: 'npm test'
- reviewInstructions: "Validate fix"
      `;

      const result = parsePromptOrSkill(skillMd);

      expect(result).toHaveProperty("success", true);
      if ("success" in result && result.success) {
        expect(result.intent.inputs.reproduceCommands).toEqual(["npm run fail"]);
        expect(result.intent.inputs.verificationCommands).toEqual(["npm test"]);
        expect(result.intent.inputs.reviewInstructions).toBe("Validate fix");
      }
    });
  });

  describe("full pipeline: skill markdown with steps to harness", () => {
    it("should compile skill markdown with custom steps all the way to harness spec", () => {
      const skillMd = `
# Custom Build Pipeline

workflow: patch-validation

## Inputs
- repoPath: /path/to/repo
- baselineRef: v1.0.0
- candidateBranch: fix-branch
- reproduceCommands: [npm run fail-test]
- verificationCommands: [npm test]
- reviewInstructions: Validate the fix

## Steps
- [tool] npm install
- [tool] npm run build
- [llm] Summarize build output
- [human] Review summary

## Verification
- npm test
      `;

      const intentResult = parsePromptOrSkill(skillMd);
      expect(intentResult).toHaveProperty("success", true);

      if (!("success" in intentResult) || !intentResult.success) return;

      const intent = intentResult.intent;
      expect(intent.steps).toHaveLength(4);

      const graph = buildTaskGraph(intent);
      expect(graph.stages.find(s => s.id === "step-1")).toBeDefined();
      expect(graph.stages.find(s => s.id === "step-4")).toBeDefined();

      const verifyNodes = graph.stages.filter(s => s.id.startsWith("verify-target-"));
      expect(verifyNodes.length).toBeGreaterThan(0);

      const risks = analyzeRisks(graph);
      const policyResult = synthesizePolicy(graph, risks);
      expect(policyResult.success).toBe(true);

      const spec = synthesizeHarness(graph, risks);
      expect(spec).toBeDefined();
      expect(spec.graph.nodes.length).toBeGreaterThan(0);
    });

    it("should still compile bundled patch-validation workflow without steps", () => {
      const skillMd = `
# Standard Patch Validation

workflow: patch-validation

## Inputs
- repoPath: /path/to/repo
- baselineRef: v1.0.0
- candidateBranch: fix-branch
- reproduceCommands: [npm run fail-test]
- verificationCommands: [npm test]
- reviewInstructions: Validate the fix
      `;

      const intentResult = parsePromptOrSkill(skillMd);
      expect(intentResult).toHaveProperty("success", true);

      if (!("success" in intentResult) || !intentResult.success) return;

      const graph = buildTaskGraph(intentResult.intent);
      expect(graph.stages.map(s => s.type)).toEqual([
        "setup", "reproduce", "apply", "verify", "review"
      ]);

      const risks = analyzeRisks(graph);
      const spec = synthesizeHarness(graph, risks);
      expect(spec.graph.entryNodeId).toBe("run-baseline");
    });

    it("should still compile bundled pr-review-merge workflow without steps", () => {
      const skillMd = `
# Standard PR Review

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

      const intentResult = parsePromptOrSkill(skillMd);
      expect(intentResult).toHaveProperty("success", true);

      if (!("success" in intentResult) || !intentResult.success) return;

      const graph = buildTaskGraph(intentResult.intent);
      expect(graph.stages.map(s => s.type)).toEqual([
        "setup", "review", "verify", "merge"
      ]);

      const risks = analyzeRisks(graph);
      const spec = synthesizeHarness(graph, risks);
      expect(spec.graph.entryNodeId).toBe("load-pr");
    });
  });
});
