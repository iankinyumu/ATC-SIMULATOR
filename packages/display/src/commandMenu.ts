import type { World } from '@atc/sim-core';

export interface MenuAction {
  readonly label: string;
  /** Null when available; otherwise why not (shown to the controller). */
  readonly unavailable: string | null;
  readonly run: () => void;
}

export interface MenuGroup {
  readonly title: string;
  readonly actions: readonly MenuAction[];
}

export interface CommandHandlers {
  /** Sends a structured command with the given transmission text. */
  send(kind: 'pushback' | 'holdPosition' | 'continueTaxi', params: Record<string, string>, words: string): void;
  /** Starts composing a taxi instruction in the command line. */
  composeTaxi(): void;
}

const FACE_NAMES = { N: 'NORTH', E: 'EAST', S: 'SOUTH', W: 'WEST' } as const;

/**
 * The commands a position can give an aircraft right now, derived from the world's authority and
 * state checks (spec §18). The context menu and the side panel both render this, so they always
 * agree with what the world will accept.
 */
export function commandMenu(world: World, positionId: string, callsign: string, h: CommandHandlers): MenuGroup[] {
  const problem = (kind: 'pushback' | 'taxi' | 'holdPosition' | 'continueTaxi', params: Record<string, string> = {}) =>
    world.commandProblem(positionId, callsign, { kind, params });

  const pushback: MenuAction[] = (['N', 'E', 'S', 'W'] as const).map((face) => ({
    label: face,
    unavailable: problem('pushback', { face }),
    run: () => h.send('pushback', { face }, `PUSH BACK APPROVED FACE ${FACE_NAMES[face]}`),
  }));

  // The destination is chosen afterwards, so only the aircraft's state is checked here.
  const taxiProblem = world.commandProblem(positionId, callsign, { kind: 'taxi', params: {} }, { checkRoute: false });

  return [
    { title: 'PUSH BACK, FACE', actions: pushback },
    {
      title: 'TAXI',
      actions: [
        { label: 'Taxi to…', unavailable: taxiProblem, run: h.composeTaxi },
        { label: 'Hold position', unavailable: problem('holdPosition'), run: () => h.send('holdPosition', {}, 'HOLD POSITION') },
        { label: 'Continue taxi', unavailable: problem('continueTaxi'), run: () => h.send('continueTaxi', {}, 'CONTINUE TAXI') },
      ],
    },
  ];
}

/** Renders menu groups as HTML buttons into `container`. `afterRun` is called after any action. */
export function renderMenu(container: HTMLElement, groups: readonly MenuGroup[], afterRun: () => void): void {
  container.replaceChildren();
  for (const group of groups) {
    const title = document.createElement('div');
    title.className = 'menu-title';
    title.textContent = group.title;
    const row = document.createElement('div');
    row.className = group.actions.length > 2 && group.actions.every((a) => a.label.length <= 2) ? 'menu-row compact' : 'menu-row';
    for (const action of group.actions) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.disabled = action.unavailable !== null;
      if (action.unavailable !== null) b.title = action.unavailable;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        action.run();
        afterRun();
      });
      row.append(b);
    }
    container.append(title, row);
    // When nothing in a group is possible, say why (hover a single button for its own reason).
    if (group.actions.every((a) => a.unavailable !== null)) {
      const why = document.createElement('div');
      why.className = 'menu-why';
      why.textContent = group.actions[0]!.unavailable!;
      container.append(why);
    }
  }
}
