import type { GameTimeMs } from './clock';

interface Task {
  readonly at: GameTimeMs;
  readonly seq: number;
  readonly run: () => void;
}

/**
 * Runs actions at a future game time. Tasks due at the same time run in the order they were
 * scheduled, so the simulation stays deterministic.
 */
export class Scheduler {
  private readonly tasks: Task[] = [];
  private nextSeq = 0;

  schedule(at: GameTimeMs, run: () => void): void {
    const task: Task = { at, seq: this.nextSeq++, run };
    let i = this.tasks.length;
    while (i > 0 && this.tasks[i - 1]!.at > at) i--;
    this.tasks.splice(i, 0, task);
  }

  /** Runs every task due at or before `now`, including tasks scheduled by those tasks. */
  runDue(now: GameTimeMs): void {
    while (this.tasks.length > 0 && this.tasks[0]!.at <= now) {
      this.tasks.shift()!.run();
    }
  }

  get size(): number {
    return this.tasks.length;
  }
}
