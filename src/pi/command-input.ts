import { readFile } from "node:fs/promises";
import { isAbsolute, win32 } from "node:path";
import type { HarnessSpec } from "../spec/types.js";
import { parseWorkflowRequest, type ReferenceWorkflowRequest } from "../reference/catalog.js";

export type ParsedCommandTarget =
  | { kind: "reference"; request: ReferenceWorkflowRequest; runtimeInput: {} }
  | { kind: "custom"; spec: HarnessSpec; runtimeInput: unknown };

type CommandName = "compile" | "run";

type GenericHarnessCommandRequest =
  | {
      spec: unknown;
      input?: unknown;
    }
  | {
      specPath: unknown;
      input?: unknown;
    };

export async function parseCommandTarget(args: string, commandName: CommandName): Promise<ParsedCommandTarget> {
  const trimmed = args.trim();
  if (!trimmed) {
    throw new Error(buildUsage(commandName));
  }

  const prefixedPath = parsePrefixedPath(trimmed);
  if (prefixedPath !== undefined) {
    if (!isAbsoluteSpecPath(prefixedPath)) {
      throw new Error("Spec path must be an absolute path");
    }

    return loadCustomSpecTarget(prefixedPath, {});
  }

  if (isAbsoluteSpecPath(trimmed)) {
    return loadCustomSpecTarget(trimmed, {});
  }

  if (looksLikeRelativeSpecPath(trimmed)) {
    throw new Error("Spec path must be an absolute path");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(buildInvalidInputMessage(commandName));
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(buildInvalidInputMessage(commandName));
  }

  const record = parsed as Record<string, unknown>;

  if ("workflow" in record) {
    return {
      kind: "reference",
      request: parseWorkflowRequest(trimmed),
      runtimeInput: {},
    };
  }

  if ("spec" in record || "specPath" in record) {
    return parseGenericHarnessCommandRequest(record as GenericHarnessCommandRequest);
  }

  if (looksLikeHarnessSpecRecord(record)) {
    return {
      kind: "custom",
      spec: record as HarnessSpec,
      runtimeInput: {},
    };
  }

  if (looksLikeLegacyReferenceRequest(record)) {
    return {
      kind: "reference",
      request: parseWorkflowRequest(trimmed),
      runtimeInput: {},
    };
  }

  throw new Error(buildInvalidInputMessage(commandName));
}

function buildUsage(commandName: CommandName): string {
  return `Usage: /lasso:${commandName} <workflow request JSON | HarnessSpec JSON | {spec|specPath,input?} | path:/abs/spec.json>`;
}

function buildInvalidInputMessage(commandName: CommandName): string {
  return `Invalid ${commandName} input. Expected workflow request JSON, HarnessSpec JSON, {spec|specPath,input?}, or an absolute spec path.`;
}

function parsePrefixedPath(value: string): string | undefined {
  if (!value.toLowerCase().startsWith("path:")) {
    return undefined;
  }

  return value.slice("path:".length).trim();
}

function isAbsoluteSpecPath(value: string): boolean {
  return isAbsolute(value) || win32.isAbsolute(value);
}

function looksLikeRelativeSpecPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return false;
  }

  if (trimmed.toLowerCase().startsWith("path:")) {
    return true;
  }

  return trimmed.endsWith(".json") || trimmed.includes("/") || trimmed.includes("\\");
}

function looksLikeHarnessSpecRecord(record: Record<string, unknown>): boolean {
  return "name" in record || "graph" in record;
}

function looksLikeLegacyReferenceRequest(record: Record<string, unknown>): boolean {
  return (
    "repoPath" in record
    || "sourceBranch" in record
    || "targetBranch" in record
    || "reviewInstructions" in record
    || "verificationCommands" in record
  );
}

async function parseGenericHarnessCommandRequest(
  record: GenericHarnessCommandRequest,
): Promise<ParsedCommandTarget> {
  const hasSpec = Object.prototype.hasOwnProperty.call(record, "spec");
  const hasSpecPath = Object.prototype.hasOwnProperty.call(record, "specPath");

  if (hasSpec === hasSpecPath) {
    throw new Error("Generic harness request must include exactly one of `spec` or `specPath`");
  }

  const runtimeInput = Object.prototype.hasOwnProperty.call(record, "input") ? record.input : {};

  if (hasSpecPath) {
    if (typeof record.specPath !== "string") {
      throw new Error("Generic harness request `specPath` must be a string");
    }

    if (!isAbsoluteSpecPath(record.specPath)) {
      throw new Error("specPath must be an absolute path");
    }

    return loadCustomSpecTarget(record.specPath, runtimeInput);
  }

  if (typeof record.spec === "string") {
    throw new Error("Generic harness request uses `specPath` for file paths, not `spec`");
  }

  if (!record.spec || typeof record.spec !== "object") {
    throw new Error("Generic harness request `spec` must be a JSON object");
  }

  return {
    kind: "custom",
    spec: record.spec as HarnessSpec,
    runtimeInput,
  };
}

async function loadCustomSpecTarget(specPath: string, runtimeInput: unknown): Promise<ParsedCommandTarget> {
  return {
    kind: "custom",
    spec: await loadHarnessSpecFromFile(specPath),
    runtimeInput,
  };
}

async function loadHarnessSpecFromFile(specPath: string): Promise<HarnessSpec> {
  let raw: string;
  try {
    raw = await readFile(specPath, "utf8");
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno?.code === "ENOENT") {
      throw new Error(`Spec file not found: ${specPath}`);
    }

    const message = errno?.message ?? String(error);
    throw new Error(`Failed to read spec file: ${specPath} (${message})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Spec file must contain valid JSON: ${specPath}`);
  }

  if (!parsed || typeof parsed !== "object" || !looksLikeHarnessSpecRecord(parsed as Record<string, unknown>)) {
    throw new Error(`Spec file must contain a HarnessSpec JSON object: ${specPath}`);
  }

  return parsed as HarnessSpec;
}
