import type { Handoff } from '../atc/handoff';
import type { SimParameters } from '../config/parameters';
import type { Rng } from '../random/rng';
import type { GameTimeMs } from '../time/clock';

/**
 * What a bot controller may do. Bots act only through the same operations as the player
 * (spec §7B); they never change aircraft state directly.
 */
export interface BotActions {
  readonly now: GameTimeMs;
  schedule(at: GameTimeMs, run: () => void): void;
  acceptHandoff(handoffId: string, positionId: string): void;
}

/**
 * Local, rule-based controller for a position the player is not working (Decision D3).
 * Deterministic: all randomness comes from its own seeded stream.
 *
 * Currently it only accepts incoming handoffs. Sequencing, standard instructions and outgoing
 * handoffs are added as the movement model and procedures arrive.
 */
export class BotController {
  constructor(
    readonly positionId: string,
    private readonly rng: Rng,
    private readonly params: SimParameters,
  ) {}

  onHandoffOffered(handoff: Handoff, actions: BotActions): void {
    const { min, max } = this.params.botHandoffAcceptDelayMs.value;
    const delay = this.rng.intInclusive(min, max);
    actions.schedule(actions.now + delay, () => actions.acceptHandoff(handoff.id, this.positionId));
  }
}
