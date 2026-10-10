import { fileURLToPath } from 'node:url';

const root = (relative: string) => fileURLToPath(new URL(`../../../${relative}`, import.meta.url));

/** Default AIRAC effective date. Update when a new cycle is imported. */
export const DEFAULT_AIRAC_DATE = '2026-10-01';

export const paths = {
  aipHtml: (airacDate: string) => root(`data/external/aip/EG-AD-2.EGLL-${airacDate}.html`),
  osmJson: root('data/external/osm/egll-aeroway.json'),
  generatedDir: root('data/generated/egll'),
};
