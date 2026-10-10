import type { Dataset } from '../data/dataset';

/** The player may work up to two positions at once (Decision D1). */
export const MAX_PLAYER_POSITIONS = 2;

/** Which positions the player works. Any combination is allowed (Decision D9). */
export class PlayerSession {
  readonly positionIds: readonly string[];

  constructor(positionIds: readonly string[], dataset: Dataset) {
    if (positionIds.length < 1 || positionIds.length > MAX_PLAYER_POSITIONS) {
      throw new Error(`The player must work 1 to ${MAX_PLAYER_POSITIONS} positions (got ${positionIds.length})`);
    }
    if (new Set(positionIds).size !== positionIds.length) throw new Error('Player positions must be different');
    const known = new Set(dataset.positions.map((p) => p.id));
    for (const id of positionIds) {
      if (!known.has(id)) throw new Error(`Unknown position "${id}"`);
    }
    this.positionIds = [...positionIds];
  }

  isPlayer(positionId: string): boolean {
    return this.positionIds.includes(positionId);
  }
}
