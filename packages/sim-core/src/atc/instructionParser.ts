import { normaliseTaxiwayName } from '../surface/graph';
import type { Command } from './commands';

/**
 * Parses a controller instruction written as words ("TST101 TAXI HOLDING POINT A10E VIA A") into
 * structured commands. The typed command line uses it now; speech recognition will feed its
 * transcript through the same parser (spec §21A), so both inputs behave identically.
 *
 * PROVISIONAL GRAMMAR: the accepted wording follows common UK usage but has not yet been checked
 * clause by clause against CAP 413. Short forms (PB, T, VIA lists) are UI conveniences.
 */

export interface ParseContext {
  /** Callsigns the controller can address. */
  readonly callsigns: readonly string[];
  readonly holdingPoints: readonly string[];
  readonly stands: readonly string[];
  /** Taxiway names, including multi-word ones such as "LINK 56". */
  readonly taxiways: readonly string[];
  /** Runway designators such as "09L/27R". */
  readonly runways: readonly string[];
  /** Used when the text does not start with a callsign (the selected aircraft). */
  readonly defaultCallsign?: string | null;
  /** Radio callsigns mapped to written ones, e.g. { "SPEEDBIRD 23K": "BAW23K" }. */
  readonly callsignAliases?: Readonly<Record<string, string>>;
}

export type ParseResult =
  | { readonly ok: true; readonly callsign: string; readonly commands: Command[]; readonly summary: string }
  | { readonly ok: false; readonly error: string; readonly callsign: string | null };

const DIRECTIONS: Record<string, 'N' | 'E' | 'S' | 'W'> = {
  N: 'N', NORTH: 'N', E: 'E', EAST: 'E', S: 'S', SOUTH: 'S', W: 'W', WEST: 'W',
};

/** Words that may appear between clauses or as filler and carry no meaning for the command. */
const FILLER = new Set(['AND', 'THEN', ',', 'APPROVED', 'PLEASE']);

class Tokens {
  private i = 0;
  constructor(readonly list: string[]) {}
  get done(): boolean {
    return this.i >= this.list.length;
  }
  peek(offset = 0): string | undefined {
    return this.list[this.i + offset];
  }
  next(): string | undefined {
    return this.list[this.i++];
  }
  /** Consumes the given word sequence if it comes next. */
  accept(...words: string[]): boolean {
    if (words.every((w, k) => this.peek(k) === w)) {
      this.i += words.length;
      return true;
    }
    return false;
  }
  rest(): string {
    return this.list.slice(this.i).join(' ');
  }
}

function tokenize(text: string): string[] {
  return text.toUpperCase().replace(/,/g, ' , ').split(/\s+/).filter((t) => t !== '');
}

/** Longest name from `names` that matches the next tokens (names may be several words). */
function matchName(tokens: Tokens, names: readonly string[]): string | null {
  let best: { name: string; words: number } | null = null;
  for (const name of names) {
    const words = normaliseTaxiwayName(name).split(' ');
    if (words.every((w, k) => tokens.peek(k) === w) && (best === null || words.length > best.words)) best = { name, words: words.length };
  }
  if (best === null) return null;
  for (let k = 0; k < best.words; k++) tokens.next();
  return best.name;
}

function matchRunway(token: string, runways: readonly string[]): string | null {
  const t = token.replace(/^RUNWAY/, '');
  return runways.find((r) => r.toUpperCase() === t || r.toUpperCase().split('/').includes(t)) ?? null;
}

const isKeyword = (t: string | undefined) =>
  t === undefined || ['VIA', 'CROSS', 'HOLD', 'CONTINUE', 'TAXI', 'PUSH', 'PUSHBACK', 'PB', 'AND', 'THEN', 'APPROVED'].includes(t);

export function parseInstruction(text: string, ctx: ParseContext): ParseResult {
  const tokens = new Tokens(tokenize(text));
  if (tokens.done) return { ok: false, error: 'Nothing to send', callsign: null };

  const callsigns = new Map(ctx.callsigns.map((c) => [c.toUpperCase(), c]));
  let callsign = callsigns.get(tokens.peek()!) ?? null;
  if (callsign !== null) tokens.next();
  else {
    const aliases = Object.entries(ctx.callsignAliases ?? {});
    const spoken = matchName(tokens, aliases.map(([radio]) => radio));
    callsign = spoken !== null ? aliases.find(([radio]) => radio === spoken)![1] : (ctx.defaultCallsign ?? null);
  }
  if (callsign === null) return { ok: false, error: `Unknown callsign "${tokens.peek()}"`, callsign: null };

  const commands: Command[] = [];
  const summary: string[] = [];
  const fail = (error: string): ParseResult => ({ ok: false, error, callsign });

  while (!tokens.done) {
    const t = tokens.peek()!;
    if (FILLER.has(t)) {
      tokens.next();
      continue;
    }

    // PUSH BACK [APPROVED] [FACE|FACING] <direction>
    if (tokens.accept('PUSH', 'BACK') || tokens.accept('PUSHBACK') || tokens.accept('PB') || tokens.accept('PUSH')) {
      tokens.accept('APPROVED');
      tokens.accept('FACE') || tokens.accept('FACING');
      const dir = tokens.peek() !== undefined ? DIRECTIONS[tokens.peek()!] : undefined;
      if (dir !== undefined) tokens.next();
      commands.push({ kind: 'pushback', params: dir !== undefined ? { face: dir } : {} });
      summary.push(`push back${dir !== undefined ? ` face ${dir}` : ''}`);
      continue;
    }

    // HOLD POSITION
    if (tokens.accept('HOLD', 'POSITION') || (tokens.peek() === 'HOLD' && tokens.peek(1) === undefined && tokens.accept('HOLD'))) {
      commands.push({ kind: 'holdPosition', params: {} });
      summary.push('hold position');
      continue;
    }

    // CONTINUE [TAXI]
    if (tokens.accept('CONTINUE', 'TAXI') || tokens.accept('CONTINUE')) {
      commands.push({ kind: 'continueTaxi', params: {} });
      summary.push('continue taxi');
      continue;
    }

    // TAXI [TO] (HOLDING POINT <hp> | STAND <stand> | <hp>) [VIA <taxiway> {[,|AND] <taxiway>}] [CROSS [RUNWAY] <rwy> {...}]
    if (tokens.accept('TAXI') || tokens.accept('T')) {
      tokens.accept('TO');
      const params: Record<string, string> = {};
      if (tokens.accept('STAND')) {
        const stand = tokens.next();
        const known = stand === undefined ? undefined : ctx.stands.find((s) => s.toUpperCase() === stand);
        if (known === undefined) return fail(stand === undefined ? 'Which stand?' : `Unknown stand ${stand}`);
        params.stand = known;
      } else {
        tokens.accept('HOLDING', 'POINT') || tokens.accept('HP');
        const hp = matchName(tokens, ctx.holdingPoints);
        if (hp === null) return fail(tokens.peek() === undefined ? 'Taxi to which holding point or stand?' : `Unknown holding point ${tokens.peek()}`);
        params.holdingPoint = hp;
      }
      const via: string[] = [];
      const cross: string[] = [];
      for (;;) {
        if (tokens.accept('VIA')) {
          do {
            const tw = matchName(tokens, ctx.taxiways);
            if (tw === null) return fail(tokens.peek() === undefined ? 'Via which taxiway?' : `Unknown taxiway ${tokens.peek()}`);
            via.push(normaliseTaxiwayName(tw));
          } while ((tokens.accept(',') || tokens.accept('AND')) && !isKeyword(tokens.peek()));
          continue;
        }
        if (tokens.accept('CROSS')) {
          tokens.accept('RUNWAY');
          const rwy = tokens.next();
          const known = rwy === undefined ? null : matchRunway(rwy, ctx.runways);
          if (known === null) return fail(rwy === undefined ? 'Cross which runway?' : `Unknown runway ${rwy}`);
          cross.push(known);
          continue;
        }
        break;
      }
      if (via.length > 0) params.via = via.join(',');
      if (cross.length > 0) params.crossRunways = cross.join(',');
      commands.push({ kind: 'taxi', params });
      summary.push(
        `taxi ${params.stand !== undefined ? `stand ${params.stand}` : `holding point ${params.holdingPoint}`}` +
          (via.length > 0 ? ` via ${via.join(', ')}` : '') +
          (cross.length > 0 ? ` crossing ${cross.join(', ')}` : ''),
      );
      continue;
    }

    return fail(`Did not understand "${tokens.rest()}"`);
  }

  if (commands.length === 0) return fail('No instruction after the callsign');
  return { ok: true, callsign, commands, summary: `${callsign} ${summary.join(', ')}` };
}
