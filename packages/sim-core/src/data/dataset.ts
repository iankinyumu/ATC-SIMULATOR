import { z } from 'zod';
import { CommandKindSchema } from '../atc/commands';
import { provenanced } from './provenance';

/**
 * Controller functions. A position performs one or more functions; e.g. in V1 the Ground position
 * also performs Delivery (spec §7, recommendation R1), so Delivery can be split out later in data.
 */
export const ControllerFunctionSchema = z.enum(['delivery', 'ground', 'tower', 'departure', 'approach', 'center']);
export type ControllerFunction = z.infer<typeof ControllerFunctionSchema>;

export const FrequencySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Real frequency in MHz. Null until taken from an authoritative source — never invented (spec §42). */
  mhz: provenanced(z.number().positive()).nullable(),
});
export type Frequency = z.infer<typeof FrequencySchema>;

export const PositionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Which display family the position uses (spec §36A). */
  display: z.enum(['surface', 'surveillance']),
  functions: z.array(ControllerFunctionSchema).min(1),
  frequencyId: z.string().min(1),
  /** Command kinds this position may issue (spec §18). */
  allowedCommands: provenanced(z.array(CommandKindSchema)),
});
export type Position = z.infer<typeof PositionSchema>;

export const DatasetSchema = z
  .object({
    meta: z.object({
      airport: z.string().min(1),
      datasetVersion: z.string().min(1),
      /** AIRAC cycle the data was taken from, e.g. "2610". Null for test fixtures. */
      airac: z.string().nullable(),
      isTestFixture: z.boolean(),
      description: z.string(),
    }),
    frequencies: z.array(FrequencySchema),
    positions: z.array(PositionSchema).min(1),
  })
  .superRefine((d, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });

    const checkUnique = (ids: string[], what: string) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) issue(`Duplicate ${what} id "${id}"`);
        seen.add(id);
      }
    };
    checkUnique(d.frequencies.map((f) => f.id), 'frequency');
    checkUnique(d.positions.map((p) => p.id), 'position');

    const frequencyIds = new Set(d.frequencies.map((f) => f.id));
    const functionOwner = new Map<ControllerFunction, string>();
    for (const p of d.positions) {
      if (!frequencyIds.has(p.frequencyId)) issue(`Position "${p.id}" uses unknown frequency "${p.frequencyId}"`);
      for (const fn of p.functions) {
        const owner = functionOwner.get(fn);
        if (owner !== undefined) issue(`Function "${fn}" is assigned to both "${owner}" and "${p.id}"`);
        functionOwner.set(fn, p.id);
      }
    }
  });
export type Dataset = z.infer<typeof DatasetSchema>;

/** Validates raw dataset JSON. Throws a ZodError listing every problem. */
export function loadDataset(raw: unknown): Dataset {
  return DatasetSchema.parse(raw);
}
