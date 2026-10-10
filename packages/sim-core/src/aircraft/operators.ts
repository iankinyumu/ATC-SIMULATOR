import { z } from 'zod';
import { ProvenanceSchema } from '../data/provenance';

export const OperatorSchema = z.object({
  /** ICAO operator designator (ICAO Doc 8585), used as the callsign prefix, e.g. "BAW". */
  icao: z.string().regex(/^[A-Z]{3}$/),
  name: z.string().min(1),
  /** Radiotelephony designator (ICAO Doc 8585), e.g. "SPEEDBIRD". */
  telephony: z.string().min(1),
  /** Terminal used at the aerodrome, e.g. "T5". */
  terminal: z.string().min(1),
  /** Relative share of traffic in generated scenarios. */
  weight: z.number().positive(),
  /** ICAO type designators the operator flies on these routes. */
  fleet: z.array(z.string()).min(1),
});
export type Operator = z.infer<typeof OperatorSchema>;

export const OperatorsFileSchema = z.object({
  meta: z.object({ version: z.string(), description: z.string() }),
  provenance: ProvenanceSchema,
  operators: z.array(OperatorSchema).min(1),
});

export function loadOperators(raw: unknown): Operator[] {
  return OperatorsFileSchema.parse(raw).operators;
}

/**
 * Radiotelephony callsign for a flight: telephony designator plus flight identification,
 * e.g. "BAW23K" → "SPEEDBIRD 23K". Returns the written callsign when the operator is unknown.
 */
export function radioCallsign(callsign: string, operators: readonly Operator[]): string {
  const op = operators.find((o) => callsign.startsWith(o.icao));
  return op === undefined ? callsign : `${op.telephony} ${callsign.slice(3)}`;
}
