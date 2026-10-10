import type { LoggedEvent, SimEvent } from '../events/eventLog';
import type { GameTimeMs } from '../time/clock';
import { World, type WorldConfig } from './world';

/**
 * Rebuilds a session from its configuration and the inputs in its event log (spec §35).
 * Given the same dataset, scenario, seed and inputs, the result is identical to the original.
 */
export function replay(config: WorldConfig, source: readonly LoggedEvent[], untilMs: GameTimeMs): World {
  const inputs = source.filter((e): e is LoggedEvent<Extract<SimEvent, { type: 'Input' }>> => e.event.type === 'Input');
  const world = new World(config);
  let next = 0;
  const applyDue = () => {
    while (next < inputs.length && inputs[next]!.t <= world.now) {
      world.apply(inputs[next]!.event.input);
      next++;
    }
  };
  while (world.now < untilMs) {
    applyDue();
    world.step();
  }
  applyDue();
  return world;
}
