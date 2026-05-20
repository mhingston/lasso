import type { HarnessVersion, LineageEntry } from "./types.js";

export interface LineageFilter {
  terminalNodeId?: string;
  since?: number;
  limit?: number;
}

export interface LineageStore {
  saveVersion(version: HarnessVersion): Promise<void>;
  saveLineage(entry: LineageEntry): Promise<void>;
  getVersion(version: number): Promise<HarnessVersion | null>;
  getLineageForVersion(version: number): Promise<LineageEntry | null>;
  getLineageChain(version: number): Promise<LineageEntry[]>;
  queryLineage(filter: LineageFilter): Promise<LineageEntry[]>;
}
