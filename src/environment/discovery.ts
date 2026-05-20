import { exec } from "node:child_process";
import { promisify } from "node:util";
import { statfs } from "node:fs/promises";
import { connect } from "node:net";
import type {
  EnvironmentModel,
  ToolCapability,
  Resource,
  Constraint,
  AuthState,
  RepoState,
  ExternalSystem,
  DiscoveryOptions,
} from "./types.js";

const execAsync = promisify(exec);

const DEFAULT_TOOLS = ["bash", "git", "node", "npm", "python", "docker", "kubectl"];

async function probeTool(name: string): Promise<ToolCapability> {
  try {
    const { stdout } = await execAsync(`${name} --version`, { timeout: 5000 });
    const version = stdout.trim().split("\n")[0].trim();
    return { name, version, available: true };
  } catch {
    return { name, available: false };
  }
}

async function probeDisk(): Promise<Resource> {
  try {
    const stat = await statfs("/");
    const totalBytes = BigInt(stat.bsize) * BigInt(stat.blocks);
    const freeBytes = BigInt(stat.bsize) * BigInt(stat.bfree);
    const usedBytes = totalBytes - freeBytes;
    const usagePct = ((Number(usedBytes) / Number(totalBytes)) * 100).toFixed(1);

    return {
      name: "disk",
      type: "disk",
      available: true,
      limit: `${(Number(totalBytes) / 1e9).toFixed(1)}GB`,
      usage: `${usagePct}%`,
    };
  } catch {
    return { name: "disk", type: "disk", available: false };
  }
}

async function probeRepo(repoPath: string): Promise<RepoState | undefined> {
  try {
    const { stdout: branch } = await execAsync("git branch --show-current", {
      cwd: repoPath,
      timeout: 5000,
    });

    const { stdout: status } = await execAsync("git status --porcelain", {
      cwd: repoPath,
      timeout: 5000,
    });

    const { stdout: remotesOut } = await execAsync("git remote", {
      cwd: repoPath,
      timeout: 5000,
    });

    const { stdout: tagsOut } = await execAsync("git tag --list", {
      cwd: repoPath,
      timeout: 5000,
    });

    return {
      path: repoPath,
      branch: branch.trim() || undefined,
      hasUncommittedChanges: status.trim().length > 0,
      remotes: remotesOut.trim().split("\n").filter(Boolean),
      tags: tagsOut.trim().split("\n").filter(Boolean),
    };
  } catch {
    return {
      path: repoPath,
      hasUncommittedChanges: false,
      remotes: [],
      tags: [],
    };
  }
}

async function probeExternalSystem(
  host: string,
  port: number,
  timeoutMs: number
): Promise<ExternalSystem> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: timeoutMs });

    socket.on("connect", () => {
      const latency = Date.now() - start;
      socket.destroy();
      resolve({ name: host, reachable: true, latencyMs: latency });
    });

    socket.on("error", (err) => {
      socket.destroy();
      resolve({ name: host, reachable: false, error: err.message });
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({ name: host, reachable: false, error: "Connection timed out" });
    });
  });
}

function detectConstraints(tools: ToolCapability[]): Constraint[] {
  const constraints: Constraint[] = [];

  const gitTool = tools.find(t => t.name === "git");
  if (gitTool && !gitTool.available) {
    constraints.push({
      type: "permission",
      description: "git is not available — repo operations will fail",
      severity: "high",
    });
  }

  const dockerTool = tools.find(t => t.name === "docker");
  if (dockerTool && !dockerTool.available) {
    constraints.push({
      type: "permission",
      description: "docker is not available — container operations will fail",
      severity: "medium",
    });
  }

  return constraints;
}

function detectAuthState(): AuthState[] {
  return [];
}

export async function discoverEnvironment(
  repoPath?: string,
  options?: DiscoveryOptions
): Promise<EnvironmentModel> {
  const toolsToProbe = options?.tools ?? DEFAULT_TOOLS;
  const toolResults = await Promise.all(toolsToProbe.map(probeTool));

  const diskResource = await probeDisk();

  let repoState: RepoState | undefined;
  if (repoPath) {
    repoState = await probeRepo(repoPath);
  }

  const externalSystems: ExternalSystem[] = [];
  if (options?.externalSystems && options.externalSystems.length > 0) {
    const timeout = options.networkTimeoutMS ?? 3000;
    const probes = options.externalSystems.map(async (host) => {
      return probeExternalSystem(host, 443, timeout);
    });
    externalSystems.push(...(await Promise.all(probes)));
  }

  const constraints = detectConstraints(toolResults);
  const authState = detectAuthState();

  return {
    tools: toolResults,
    resources: [diskResource],
    constraints,
    authState,
    repoState,
    externalSystems,
    discoveredAt: Date.now(),
  };
}
