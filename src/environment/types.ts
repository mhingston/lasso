export interface ToolCapability {
  name: string;
  version?: string;
  available: boolean;
  path?: string;
}

export interface Resource {
  name: string;
  type: "disk" | "memory" | "network" | "cpu";
  available: boolean;
  limit?: string;
  usage?: string;
}

export interface Constraint {
  type: "auth" | "network" | "permission" | "rate-limit";
  description: string;
  severity: "low" | "medium" | "high";
}

export interface AuthState {
  system: string;
  authenticated: boolean;
  expiresAt?: number;
  scopes?: string[];
}

export interface RepoState {
  path: string;
  branch?: string;
  hasUncommittedChanges: boolean;
  remotes: string[];
  tags: string[];
}

export interface ExternalSystem {
  name: string;
  reachable: boolean;
  latencyMs?: number;
  error?: string;
}

export interface EnvironmentModel {
  tools: ToolCapability[];
  resources: Resource[];
  constraints: Constraint[];
  authState: AuthState[];
  repoState?: RepoState;
  externalSystems: ExternalSystem[];
  discoveredAt: number;
}

export interface DiscoveryOptions {
  tools?: string[];
  checkAuth?: boolean;
  checkNetwork?: boolean;
  networkTimeoutMs?: number;
  externalSystems?: string[];
}

export interface EnvironmentAnalysis {
  matchedTools: ToolCapability[];
  missingTools: string[];
  highRiskConstraints: Constraint[];
  readinessScore: number;
  preparatorySteps: string[];
}
