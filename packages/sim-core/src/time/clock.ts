/** Game time in milliseconds since the Unix epoch (UTC). Never the real-world clock (spec §35B). */
export type GameTimeMs = number;

/** Simulation speeds the player can select (spec §35B). */
export const SIM_SPEEDS = [1, 2, 4] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];

/**
 * Fixed-step game clock.
 *
 * The simulation core only ever calls `tick()`. The outer game loop calls `stepsForRealElapsed()`
 * with real elapsed time to decide how many ticks to run; that is the only place real time enters.
 */
export class SimClock {
  private current: GameTimeMs;
  private isPaused = false;
  private currentSpeed: SimSpeed = 1;
  private accumulatorMs = 0;

  constructor(
    startTime: GameTimeMs,
    readonly stepMs: number,
    /** Upper bound on catch-up steps per call, so a stalled frame cannot freeze the game. */
    readonly maxStepsPerCall = 50,
  ) {
    if (!Number.isInteger(stepMs) || stepMs <= 0) throw new Error(`stepMs must be a positive integer (got ${stepMs})`);
    this.current = startTime;
  }

  get now(): GameTimeMs {
    return this.current;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  get speed(): SimSpeed {
    return this.currentSpeed;
  }

  pause(): void {
    this.isPaused = true;
    this.accumulatorMs = 0;
  }

  resume(): void {
    this.isPaused = false;
  }

  setSpeed(speed: SimSpeed): void {
    this.currentSpeed = speed;
  }

  /** Advances game time by exactly one fixed step. */
  tick(): GameTimeMs {
    this.current += this.stepMs;
    return this.current;
  }

  /** Converts real elapsed time into a number of fixed steps, honouring pause and speed. */
  stepsForRealElapsed(realElapsedMs: number): number {
    if (this.isPaused || realElapsedMs <= 0) return 0;
    this.accumulatorMs += realElapsedMs * this.currentSpeed;
    let steps = Math.floor(this.accumulatorMs / this.stepMs);
    this.accumulatorMs -= steps * this.stepMs;
    if (steps > this.maxStepsPerCall) {
      steps = this.maxStepsPerCall;
      this.accumulatorMs = 0;
    }
    return steps;
  }
}
