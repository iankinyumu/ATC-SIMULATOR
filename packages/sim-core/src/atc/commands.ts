import { z } from 'zod';

/**
 * Structured controller command kinds (spec §17).
 *
 * Which position may issue which kind is NOT decided here; it comes from the dataset's authority
 * data (spec §18).
 */
export const COMMAND_KINDS = [
  'departureClearance',
  'pushback',
  'taxi',
  'holdPosition',
  'continueTaxi',
  'holdShort',
  'crossRunway',
  'lineUp',
  'takeoff',
  'landing',
  'goAround',
  'heading',
  'altitude',
  'speed',
  'direct',
  'squawk',
  'frequencyChange',
] as const;

export const CommandKindSchema = z.enum(COMMAND_KINDS);
export type CommandKind = z.infer<typeof CommandKindSchema>;

/**
 * Command parameters. Kept generic until each command's effect on the aircraft is implemented
 * with the movement model; each kind will then get a typed parameter shape.
 *
 * - `frequencyChange`: `{ toPositionId }`
 * - `pushback`: `{ face?: 'N' | 'E' | 'S' | 'W' }` (required when more than one direction is possible)
 * - `taxi`: `{ holdingPoint } | { stand }`, plus optional `via` ("A,LINK 22") and `crossRunways` ("09R/27L")
 * - `holdPosition`, `continueTaxi`: no parameters
 */
export type CommandParams = Readonly<Record<string, string | number | boolean>>;

export interface Command {
  readonly kind: CommandKind;
  readonly params: CommandParams;
}
