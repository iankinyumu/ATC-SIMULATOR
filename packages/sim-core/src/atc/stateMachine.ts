import type { GameTimeMs } from '../time/clock';

export class IllegalTransitionError extends Error {
  constructor(entity: string, id: string, from: string, to: string) {
    super(`${entity} ${id}: illegal transition ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export interface HistoryEntry<S extends string> {
  readonly state: S;
  readonly t: GameTimeMs;
  readonly reason?: string;
}

export interface Tracked<S extends string> {
  readonly id: string;
  state: S;
  readonly history: HistoryEntry<S>[];
}

export type TransitionListener<E, S extends string> = (entity: E, from: S | null, to: S, reason?: string) => void;

/**
 * Stores entities that move through a fixed transition table and rejects any transition the
 * table does not allow. Every change is recorded in the entity's history and reported to the
 * listener (which writes it to the event log).
 */
export class StateMachineStore<S extends string, E extends Tracked<S>> {
  private readonly byId = new Map<string, E>();
  private nextId = 1;

  constructor(
    private readonly entityName: string,
    private readonly idPrefix: string,
    private readonly transitions: Readonly<Record<S, readonly S[]>>,
    private readonly now: () => GameTimeMs,
    private readonly listener: TransitionListener<E, S>,
  ) {}

  /** Adds a new entity. `build` returns it in its initial state with an empty history. */
  protected add(build: (id: string) => E): E {
    const id = `${this.idPrefix}${this.nextId++}`;
    const entity = build(id);
    entity.history.push({ state: entity.state, t: this.now() });
    this.byId.set(id, entity);
    this.listener(entity, null, entity.state);
    return entity;
  }

  get(id: string): E | undefined {
    return this.byId.get(id);
  }

  all(): E[] {
    return [...this.byId.values()];
  }

  canTransition(id: string, to: S): boolean {
    const entity = this.byId.get(id);
    return entity !== undefined && this.transitions[entity.state].includes(to);
  }

  transition(id: string, to: S, reason?: string): E {
    const entity = this.byId.get(id);
    if (entity === undefined) throw new Error(`Unknown ${this.entityName} ${id}`);
    if (!this.transitions[entity.state].includes(to)) {
      throw new IllegalTransitionError(this.entityName, id, entity.state, to);
    }
    const from = entity.state;
    entity.state = to;
    entity.history.push(reason === undefined ? { state: to, t: this.now() } : { state: to, t: this.now(), reason });
    this.listener(entity, from, to, reason);
    return entity;
  }
}
