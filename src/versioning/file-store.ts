import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessVersion, LineageEntry } from "./types.js";
import type { LineageFilter, LineageStore } from "./store.js";

export class FileLineageStore implements LineageStore {
  private readonly versionsDir: string;
  private readonly lineageDir: string;

  constructor(private readonly storeDir: string) {
    this.versionsDir = join(storeDir, "versions");
    this.lineageDir = join(storeDir, "lineage");
  }

  async saveVersion(version: HarnessVersion): Promise<void> {
    await mkdir(this.versionsDir, { recursive: true });
    const data = structuredClone(version);
    const filePath = join(this.versionsDir, `${version.version}.json`);
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  async saveLineage(entry: LineageEntry): Promise<void> {
    await mkdir(this.lineageDir, { recursive: true });
    const data = structuredClone(entry);
    const filePath = join(this.lineageDir, `${entry.version}.json`);
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  async getVersion(version: number): Promise<HarnessVersion | null> {
    try {
      const filePath = join(this.versionsDir, `${version}.json`);
      const raw = await readFile(filePath, "utf-8");
      return JSON.parse(raw) as HarnessVersion;
    } catch {
      return null;
    }
  }

  async getLineageForVersion(version: number): Promise<LineageEntry | null> {
    try {
      const filePath = join(this.lineageDir, `${version}.json`);
      const raw = await readFile(filePath, "utf-8");
      return JSON.parse(raw) as LineageEntry;
    } catch {
      return null;
    }
  }

  async getLineageChain(version: number): Promise<LineageEntry[]> {
    const chain: LineageEntry[] = [];
    let current: number | undefined = version;

    while (current !== undefined) {
      const [entry, versionData] = await Promise.all([
        this.getLineageForVersion(current),
        this.getVersion(current),
      ]);

      if (!entry || !versionData) {
        break;
      }

      chain.unshift(entry);
      current = versionData.parentVersion;
    }

    return chain;
  }

  async queryLineage(filter: LineageFilter): Promise<LineageEntry[]> {
    let entries = await this.loadAllLineage();

    if (filter.terminalNodeId) {
      entries = entries.filter((e) => e.terminalNodeId === filter.terminalNodeId);
    }

    if (filter.since !== undefined) {
      entries = entries.filter((e) => e.completedAt >= filter.since!);
    }

    if (filter.limit !== undefined) {
      entries = entries.slice(0, filter.limit);
    }

    return entries;
  }

  private async loadAllLineage(): Promise<LineageEntry[]> {
    try {
      const files = await readdir(this.lineageDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      const entries = await Promise.all(
        jsonFiles.map(async (file) => {
          const raw = await readFile(join(this.lineageDir, file), "utf-8");
          return JSON.parse(raw) as LineageEntry;
        }),
      );
      return entries.sort((a, b) => a.version - b.version);
    } catch {
      return [];
    }
  }
}
