import { codeLetter, type Aircraft, type Clearance, type CommandKind, type World } from '@atc/sim-core';
import { commandMenu, type CommandHandlers } from './commandMenu';

export interface StripHandlers {
  select(callsign: string): void;
  /** Sends a structured command for the aircraft. */
  send(callsign: string, kind: CommandKind, params: Record<string, string>, words: string): void;
  /** Starts an instruction for the aircraft in the command line. */
  compose(callsign: string, text: string): void;
}

const FACE_NAMES = { N: 'NORTH', E: 'EAST', S: 'SOUTH', W: 'WEST' } as const;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16);

/** Short strip wording for a clearance, as a controller would mark a paper strip. */
export function clearanceText(c: Clearance): string {
  const p = c.command.params;
  switch (c.command.kind) {
    case 'pushback':
      return `PUSH${typeof p.face === 'string' ? ` FACE ${p.face}` : ''}`;
    case 'taxi':
      if (typeof p.stand === 'string') return `TAXI STAND ${p.stand}`;
      return `TAXI ${String(p.holdingPoint ?? '')}${typeof p.via === 'string' ? ` VIA ${p.via.replace(/,/g, ' ')}` : ''}${typeof p.crossRunways === 'string' ? ` X ${p.crossRunways}` : ''}`;
    case 'holdPosition':
      return 'HOLD POSITION';
    case 'continueTaxi':
      return 'CONTINUE TAXI';
    default:
      return c.command.kind.toUpperCase();
  }
}

interface Action {
  readonly label: string;
  readonly go?: boolean;
  readonly disabled?: string | null;
  readonly run: () => void;
}

/**
 * Electronic flight strip bay. One strip per aircraft, grouped like a strip board (requests,
 * moving, holding, parked). Strips carry quick answers to pilot requests; the selected strip opens
 * to show details and every command currently possible.
 */
export class StripBay {
  private html = '';
  private actions = new Map<string, Action>();

  constructor(
    private readonly el: HTMLElement,
    private readonly world: World,
    private readonly positionId: string,
    private readonly handlers: StripHandlers,
  ) {
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const button = target.closest<HTMLElement>('[data-action]');
      if (button !== null) {
        e.stopPropagation();
        if (!(button as HTMLButtonElement).disabled) this.actions.get(button.dataset.action!)?.run();
        return;
      }
      const strip = target.closest<HTMLElement>('.strip');
      if (strip?.dataset.cs !== undefined) handlers.select(strip.dataset.cs);
    });
  }

  /** Rebuilds the bay when anything shown on it changed; otherwise only updates the timers. */
  render(selected: string | null): void {
    const aircraft = this.world.allAircraft().filter((a) => a.surface !== null);
    const pending = new Map(this.world.requests.pending().map((r) => [r.callsign, r]));
    const groups: Array<[string, Readonly<Aircraft>[]]> = [
      ['REQUESTS', aircraft.filter((a) => pending.has(a.callsign)).sort((a, b) => pending.get(a.callsign)!.history[0]!.t - pending.get(b.callsign)!.history[0]!.t)],
      ['MOVING', aircraft.filter((a) => !pending.has(a.callsign) && (a.surface!.phase === 'taxi' || a.surface!.phase === 'pushback'))],
      ['HOLDING', aircraft.filter((a) => !pending.has(a.callsign) && a.surface!.phase === 'holding')],
      ['PARKED', aircraft.filter((a) => !pending.has(a.callsign) && a.surface!.phase === 'parked')],
    ];

    const actions = new Map<string, Action>();
    const parts: string[] = [];
    for (const [title, list] of groups) {
      parts.push(`<div class="bay-title">${title}<b>${list.length}</b></div>`);
      if (list.length === 0) parts.push('<div class="bay-empty">—</div>');
      for (const a of list) parts.push(this.strip(a, a.callsign === selected, actions));
    }
    const html = parts.join('');
    if (html !== this.html) {
      this.html = html;
      this.actions = actions;
      const scroll = this.el.scrollTop;
      this.el.innerHTML = html;
      this.el.scrollTop = scroll;
    }
    // Waiting timers change every second without anything else changing.
    for (const span of this.el.querySelectorAll<HTMLElement>('[data-since]')) {
      const s = Math.max(0, Math.floor((this.world.now - Number(span.dataset.since)) / 1000));
      span.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
  }

  private strip(a: Readonly<Aircraft>, selected: boolean, actions: Map<string, Action>): string {
    const s = a.surface!;
    const request = this.world.requests.pendingFor(a.callsign);
    const arrival = a.flight?.kind === 'arrival';
    const latest = this.world.clearances
      .forAircraft(a.callsign)
      .filter((c) => c.state !== 'cancelled')
      .pop();

    // Main line: what the pilot wants, else the current clearance, else the state.
    let instr: string;
    let instrClass = '';
    if (request !== undefined) {
      const words = request.kind === 'pushback' ? 'REQ PUSHBACK' : request.kind === 'taxi' ? 'READY FOR TAXI' : `REQ STAND ${request.stand ?? ''}`;
      instr = `${words} <span data-since="${request.history[0]!.t}"></span>${request.calls > 1 ? ` ×${request.calls}` : ''}`;
      instrClass = 'req';
    } else if (latest !== undefined && latest.state !== 'completed') {
      instr = esc(clearanceText(latest)) + (latest.state === 'assigned' || latest.state === 'transmitted' ? ' …' : '');
    } else {
      instr = s.phase === 'parked' ? (arrival ? 'ON STAND' : 'AWAITING') : s.phase === 'holding' ? (s.motion !== null ? 'HOLDING POSITION' : 'HOLDING') : s.phase.toUpperCase();
    }

    const where = s.motion !== null ? `→ ${s.motion.limit.toUpperCase()}` : s.standName !== null ? `STAND ${s.standName}` : '';
    const sub = `${s.phase.toUpperCase()}${where ? ` · ${esc(where)}` : ''}`;
    const stand = s.standName ?? (a.flight?.kind === 'arrival' ? `→${a.flight.stand}` : '—');
    const limit = s.motion?.toStand === null && s.motion !== null ? s.motion.limit : '—';
    const time = a.flight?.kind === 'departure' ? `RDY ${hhmm(a.flight.readyAtMs)}` : arrival ? 'ARR' : '';

    const buttons = selected ? this.selectedActions(a) : this.quickActions(a);
    const buttonHtml = buttons
      .map((b) => {
        const id = `${a.callsign}:${b.label}`;
        actions.set(id, b);
        const disabled = b.disabled != null;
        return `<button data-action="${esc(id)}"${b.go === true ? ' class="go"' : ''}${disabled ? ` disabled title="${esc(b.disabled!)}"` : ''}>${esc(b.label)}</button>`;
      })
      .join('');

    let detail = '';
    if (selected) {
      const t = a.type;
      const typeText = t === null ? esc(a.typeDesignator ?? 'type unknown') : `<b>${esc(t.name)}</b> · ${t.icao} · wake ${t.wakeCategory} · code ${codeLetter(t.wingspanM) ?? '?'} · span ${t.wingspanM} m`;
      const flight = a.flight === null ? '' : a.flight.kind === 'departure' ? `Departure · ready ${hhmm(a.flight.readyAtMs)}Z` : `Arrival · stand ${esc(a.flight.stand)}`;
      const open = this.world.clearances
        .forAircraft(a.callsign)
        .filter((c) => c.state !== 'completed' && c.state !== 'cancelled')
        .map((c) => `${esc(clearanceText(c))} (${c.state})`);
      detail =
        `<div class="s-detail">${typeText}<br>${flight}${flight ? ' · ' : ''}heading ${String(Math.round(s.headingTrueDeg) % 360).padStart(3, '0')}°T` +
        `${open.length > 0 ? `<br>Clearances: ${open.join(', ')}` : ''}</div>`;
    }
    // A quick answer that cannot be given (e.g. the requested stand is now taken): say why.
    const blocked = buttons.find((b) => b.disabled != null);
    const why = blocked !== undefined ? `<div class="s-why">${esc(blocked.disabled!)}</div>` : '';

    const classes = ['strip', arrival ? 'arr' : 'dep', request !== undefined ? 'req' : '', selected ? 'sel' : ''].filter(Boolean).join(' ');
    return (
      `<div class="${classes}" data-cs="${esc(a.callsign)}">` +
      `<div class="s-id"><b>${esc(a.callsign)}</b><span>${esc(a.typeDesignator ?? '—')}${a.type !== null ? ` / ${a.type.wakeCategory}` : ''}</span></div>` +
      `<div class="s-main"><div class="s-instr ${instrClass}">${instr}</div><div class="s-sub">${sub}</div></div>` +
      `<div class="s-box"><div>${esc(stand)}</div><div>${esc(limit)}</div><div>${esc(time)}</div></div>` +
      detail +
      (buttonHtml !== '' ? `<div class="s-actions">${buttonHtml}</div>` : '') +
      why +
      `</div>`
    );
  }

  /** One-click answers for what the pilot is asking, plus hold/continue while moving. */
  private quickActions(a: Readonly<Aircraft>): Action[] {
    const cs = a.callsign;
    const s = a.surface!;
    const r = this.world.requests.pendingFor(cs);
    const out: Action[] = [];
    if (r?.kind === 'pushback') {
      for (const face of this.world.pushbackFaces(this.positionId, cs)) {
        out.push({ label: `PUSH ${face}`, go: true, run: () => this.handlers.send(cs, 'pushback', { face }, `PUSH BACK APPROVED FACE ${FACE_NAMES[face]}`) });
      }
    } else if (r?.kind === 'taxi') {
      out.push({ label: 'TAXI TO…', go: true, run: () => this.handlers.compose(cs, 'TAXI HOLDING POINT ') });
    } else if (r?.kind === 'taxiToStand' && r.stand !== null) {
      const stand = r.stand;
      const problem = this.world.commandProblem(this.positionId, cs, { kind: 'taxi', params: { stand } });
      out.push({ label: `STAND ${stand}`, go: true, disabled: problem, run: () => this.handlers.send(cs, 'taxi', { stand }, `TAXI STAND ${stand}`) });
      out.push({ label: 'OTHER STAND…', run: () => this.handlers.compose(cs, 'TAXI STAND ') });
    }
    if (s.phase === 'taxi') out.push({ label: 'HOLD', run: () => this.handlers.send(cs, 'holdPosition', {}, 'HOLD POSITION') });
    if (s.phase === 'holding' && s.motion?.holdClearanceId != null) out.push({ label: 'CONTINUE', go: true, run: () => this.handlers.send(cs, 'continueTaxi', {}, 'CONTINUE TAXI') });
    return out;
  }

  /** Every command the position could give this aircraft now (same source as the context menu). */
  private selectedActions(a: Readonly<Aircraft>): Action[] {
    const cs = a.callsign;
    const quick = this.quickActions(a);
    const h: CommandHandlers = {
      send: (kind, params, words) => this.handlers.send(cs, kind, params, words),
      composeTaxi: () => this.handlers.compose(cs, 'TAXI HOLDING POINT '),
    };
    const menu = commandMenu(this.world, this.positionId, cs, h)
      .flatMap((g) => g.actions.map((x) => ({ ...x, label: g.title.startsWith('PUSH') ? `PUSH ${x.label}` : x.label.toUpperCase() })))
      .filter((x) => x.unavailable === null && !quick.some((q) => q.label === x.label || (q.label === 'HOLD' && x.label === 'HOLD POSITION') || (q.label === 'CONTINUE' && x.label === 'CONTINUE TAXI')));
    return [...quick, ...menu.map((x) => ({ label: x.label, run: x.run }))];
  }
}
