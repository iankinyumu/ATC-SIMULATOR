import { z } from 'zod';

/** Status of an operational value in the parameter provenance register (spec §41). */
export const ProvenanceStatusSchema = z.enum(['sourced', 'derived', 'owner-decision', 'placeholder']);
export type ProvenanceStatus = z.infer<typeof ProvenanceStatusSchema>;

export const ProvenanceSchema = z
  .object({
    status: ProvenanceStatusSchema,
    /** Source tier from spec §47 (1 = authoritative publication … 6 = development placeholder). */
    tier: z.number().int().min(1).max(6).optional(),
    /** Document, edition/AIRAC and section/page. Required for sourced values. */
    citation: z.string().min(1).optional(),
    note: z.string().optional(),
  })
  .refine((p) => p.status !== 'sourced' || p.citation !== undefined, {
    message: 'A sourced value must have a citation',
  });
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** Schema for a value that carries its units and provenance. */
export function provenanced<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value,
    units: z.string().optional(),
    provenance: ProvenanceSchema,
  });
}

export interface Provenanced<T> {
  value: T;
  units?: string;
  provenance: Provenance;
}

export interface ProvenanceEntry {
  /** Where the value sits in the data, e.g. `positions[0].allowedCommands`. */
  path: string;
  value: unknown;
  units?: string;
  provenance: Provenance;
}

/** Walks any data object and lists every provenanced value. This is the provenance register. */
export function collectProvenance(data: unknown): ProvenanceEntry[] {
  const entries: ProvenanceEntry[] = [];
  const visit = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}[${i}]`));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if ('value' in obj && 'provenance' in obj) {
      const parsed = ProvenanceSchema.safeParse(obj.provenance);
      if (parsed.success) {
        entries.push({
          path,
          value: obj.value,
          provenance: parsed.data,
          ...(typeof obj.units === 'string' ? { units: obj.units } : {}),
        });
        return;
      }
    }
    for (const [key, child] of Object.entries(obj)) visit(child, path ? `${path}.${key}` : key);
  };
  visit(data, '');
  return entries;
}
