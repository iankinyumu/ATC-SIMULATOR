import type { Command } from '../atc/commands';
import type { RequestKind } from '../pilots/requests';

/**
 * Builds radio transmissions from structured data (spec §21: operational command → phraseology).
 * Written text is upper case, as it would appear on a transcript; `toSpoken` turns it into words
 * for a voice. PROVISIONAL WORDING: follows common UK/ICAO usage, not yet checked clause by clause
 * against CAP 413 (assumption A7).
 */

const FACES: Record<string, string> = { N: 'NORTH', E: 'EAST', S: 'SOUTH', W: 'WEST' };

/** Station name a pilot uses for a position, e.g. "GROUND" for the position named "Ground". */
export function stationName(positionName: string): string {
  return positionName.toUpperCase().replace(/\s*\/.*$/, '');
}

/** The part of a readback for one command. */
function readbackPart(c: Command, positionNames: (id: string) => string | undefined): string {
  const p = c.params;
  switch (c.kind) {
    case 'pushback':
      return `PUSH BACK APPROVED${typeof p.face === 'string' && FACES[p.face] !== undefined ? `, FACE ${FACES[p.face]}` : ''}`;
    case 'taxi': {
      const to = typeof p.stand === 'string' ? `TAXI STAND ${p.stand}` : `TAXI HOLDING POINT ${String(p.holdingPoint ?? '')}`;
      const via = typeof p.via === 'string' ? ` VIA ${p.via.split(',').join(', ')}` : '';
      const cross = typeof p.crossRunways === 'string' ? `, CROSS RUNWAY ${p.crossRunways.split(',').join(' AND ')}` : '';
      return `${to}${via}${cross}`;
    }
    case 'holdPosition':
      return 'HOLDING POSITION';
    case 'continueTaxi':
      return 'CONTINUE TAXI';
    case 'frequencyChange': {
      const name = typeof p.toPositionId === 'string' ? positionNames(p.toPositionId) : undefined;
      return `CONTACT ${name !== undefined ? stationName(name) : 'NEXT FREQUENCY'}`;
    }
    case 'squawk':
      return `SQUAWK ${String(p.code ?? '')}`.trim();
    default:
      return c.kind.replace(/([A-Z])/g, ' $1').toUpperCase();
  }
}

/** Pilot readback: the instructions read back, followed by the callsign. */
export function readbackText(commands: readonly Command[], callsign: string, positionNames: (id: string) => string | undefined): string {
  return `${commands.map((c) => readbackPart(c, positionNames)).join(', ')}, ${callsign}`;
}

/** A pilot's request to the position it is talking to. */
export function requestText(kind: RequestKind, callsign: string, station: string, stand: string | null): string {
  switch (kind) {
    case 'pushback':
      return `${station}, ${callsign}, ${stand !== null ? `STAND ${stand}, ` : ''}REQUEST PUSHBACK`;
    case 'taxi':
      return `${callsign}, READY FOR TAXI`;
    case 'taxiToStand':
      return `${station}, ${callsign}, VACATED, REQUEST TAXI TO STAND ${stand ?? ''}`.trim();
  }
}

export const holdingReportText = (callsign: string, limit: string) => `${callsign}, HOLDING AT ${limit}`;
export const sayAgainText = (callsign: string) => `SAY AGAIN, ${callsign}`;
export const initialCallText = (station: string, callsign: string) => `${station}, ${callsign}`;

// -------------------------------------------------------------------------------------------------
// Spoken form
// -------------------------------------------------------------------------------------------------

/** ICAO spelling alphabet. */
const LETTERS: Record<string, string> = {
  A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India',
  J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
  S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
};

/**
 * Digits as words for a voice. 9 is "niner" as in radiotelephony; 3 and 5 are written "three" and
 * "five" because the ICAO/CAP 413 spellings "tree" and "fife" are pronunciation guides, and a
 * text-to-speech voice reading them literally sounds wrong.
 */
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];

const RUNWAY_SIDES: Record<string, string> = { L: 'left', R: 'right', C: 'centre' };

/** Spells a designator such as "A10E" → "Alpha one zero Echo" or "541" → "fife four one". */
export function spellDesignator(token: string): string {
  return [...token].map((ch) => (/\d/.test(ch) ? DIGITS[Number(ch)]! : (LETTERS[ch] ?? ch))).join(' ');
}

/** "09R" → "zero niner right"; "09R/27L" → "zero niner right" (the end in use is said, not both). */
function spellRunway(token: string): string {
  const first = token.split('/')[0]!;
  const m = /^(\d{2})([LRC]?)$/.exec(first);
  if (m === null) return spellDesignator(first);
  return `${spellDesignator(m[1]!)}${m[2] ? ` ${RUNWAY_SIDES[m[2]]}` : ''}`;
}

/**
 * Turns written transmission text into words for a voice: designators and numbers are spelled
 * with the spelling alphabet and radiotelephony digits; plain words are left as words.
 */
export function toSpoken(text: string): string {
  const words = text.split(/(\s+|,)/);
  let previous = '';
  const out = words.map((w) => {
    if (w.trim() === '' || w === ',') return w;
    const token = w.toUpperCase();
    let spoken: string;
    if (previous === 'RUNWAY' || /^\d{2}[LRC]?\/\d{2}[LRC]?$/.test(token)) spoken = spellRunway(token);
    else if (/^[A-Z]+$/.test(token) && !/\d/.test(token) && token.length > 1) spoken = token.toLowerCase();
    else if (/^[A-Z]$/.test(token)) spoken = LETTERS[token]!;
    else spoken = spellDesignator(token);
    previous = token;
    return spoken;
  });
  return out.join('').replace(/\s+,/g, ',').replace(/^\w/, (c) => c.toUpperCase()) + '.';
}
