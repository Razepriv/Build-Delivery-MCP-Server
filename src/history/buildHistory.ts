import type { BuildHistoryEntry } from "../types.js";

const DEFAULT_CAPACITY = 100;

export class BuildHistory {
  private readonly capacity: number;
  private entries: BuildHistoryEntry[] = [];

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  append(entry: BuildHistoryEntry): void {
    this.entries = [entry, ...this.entries].slice(0, this.capacity);
  }

  list(limit = 10): BuildHistoryEntry[] {
    return this.entries.slice(0, Math.max(1, Math.min(limit, this.capacity)));
  }

  size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
  }
}
