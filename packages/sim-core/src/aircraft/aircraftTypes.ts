import { z } from 'zod';
import { ProvenanceSchema } from '../data/provenance';

export const AircraftTypeSchema = z.object({
  /** ICAO type designator (ICAO Doc 8643), e.g. "A320". */
  icao: z.string().regex(/^[A-Z0-9]{2,4}$/),
  name: z.string().min(1),
  /** ICAO wake turbulence category: L, M, H or J (Super). */
  wakeCategory: z.enum(['L', 'M', 'H', 'J']),
  wingspanM: z.number().positive(),
  lengthM: z.number().positive(),
});
export type AircraftType = z.infer<typeof AircraftTypeSchema>;

export const AircraftTypesFileSchema = z
  .object({
    meta: z.object({ version: z.string(), description: z.string() }),
    dimensionsProvenance: ProvenanceSchema,
    categoryProvenance: ProvenanceSchema,
    types: z.array(AircraftTypeSchema).min(1),
  })
  .superRefine((d, ctx) => {
    const seen = new Set<string>();
    for (const t of d.types) {
      if (seen.has(t.icao)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate aircraft type ${t.icao}` });
      seen.add(t.icao);
    }
  });
export type AircraftTypesFile = z.infer<typeof AircraftTypesFileSchema>;

export function loadAircraftTypes(raw: unknown): AircraftTypesFile {
  return AircraftTypesFileSchema.parse(raw);
}

/**
 * Aerodrome reference code letter from wingspan, using the upper limits of ICAO Annex 14
 * Volume I, Table 1-1 (A < 15 m, B < 24 m, C < 36 m, D < 52 m, E < 65 m, F < 80 m).
 * Provenance: recalled, not yet checked against the current edition.
 */
export function codeLetter(wingspanM: number): 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | null {
  const limits = [
    ['A', 15],
    ['B', 24],
    ['C', 36],
    ['D', 52],
    ['E', 65],
    ['F', 80],
  ] as const;
  return limits.find(([, max]) => wingspanM < max)?.[0] ?? null;
}
