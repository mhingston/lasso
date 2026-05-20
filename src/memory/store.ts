import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessMemory, MemoryStore, MemoryUpdate, MemoryQuery } from "./types.js";

export class FileMemoryStore implements MemoryStore {
  private readonly memoriesDir: string;

  constructor(private readonly storeDir: string) {
    this.memoriesDir = join(storeDir, "memories");
  }

  async saveMemory(memory: HarnessMemory): Promise<void> {
    await mkdir(this.memoriesDir, { recursive: true });
    const data = structuredClone(memory);
    const filePath = join(this.memoriesDir, `${memory.taskId}.json`);
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await rename(tmpPath, filePath);
  }

  async getMemory(taskId: string): Promise<HarnessMemory | null> {
    try {
      const filePath = join(this.memoriesDir, `${taskId}.json`);
      const raw = await readFile(filePath, "utf-8");
      return JSON.parse(raw) as HarnessMemory;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw err;
    }
  }

  async updateMemory(taskId: string, update: MemoryUpdate): Promise<HarnessMemory> {
    const existing = await this.getMemory(taskId);
    if (!existing) {
      throw new Error(`Memory not found for task: ${taskId}`);
    }

    const updated: HarnessMemory = structuredClone(existing);

    if (update.successfulPattern) {
      if (!updated.successfulPatterns.includes(update.successfulPattern)) {
        updated.successfulPatterns.push(update.successfulPattern);
      }
    }

    if (update.failedPattern) {
      if (!updated.failedPatterns.includes(update.failedPattern)) {
        updated.failedPatterns.push(update.failedPattern);
      }
    }

    if (update.mutation) {
      updated.mutationHistory.push(structuredClone(update.mutation));
    }

    if (update.effectivenessDelta !== undefined) {
      updated.effectivenessScore = Math.max(
        0,
        Math.min(1, updated.effectivenessScore + update.effectivenessDelta),
      );
    }

    updated.lastUpdated = Date.now();

    await this.saveMemory(updated);
    return updated;
  }

  async searchMemories(query: MemoryQuery): Promise<HarnessMemory[]> {
    let memories = await this.loadAllMemories();

    if (query.taskSignature) {
      memories = memories.filter(
        (m) => m.taskEmbedding && m.taskEmbedding.includes(query.taskSignature!),
      );
    }

    if (query.minEffectiveness !== undefined) {
      memories = memories.filter(
        (m) => m.effectivenessScore >= query.minEffectiveness!,
      );
    }

    if (query.limit !== undefined) {
      memories = memories.slice(0, query.limit);
    }

    return memories;
  }

  private async loadAllMemories(): Promise<HarnessMemory[]> {
    try {
      const files = await readdir(this.memoriesDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      const memories = await Promise.all(
        jsonFiles.map(async (file) => {
          const raw = await readFile(join(this.memoriesDir, file), "utf-8");
          return JSON.parse(raw) as HarnessMemory;
        }),
      );
      return memories.sort((a, b) => b.effectivenessScore - a.effectivenessScore);
    } catch {
      return [];
    }
  }
}
