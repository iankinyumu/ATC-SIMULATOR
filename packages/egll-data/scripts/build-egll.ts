/**
 * Builds the EGLL surface dataset from the downloaded AIP and OSM data, validates it, and writes
 * the dataset and a cross-check report to data/generated/egll/.
 *
 *   npm run data:build [-- 2026-10-01]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSurfaceDataset } from '@atc/sim-core';
import { buildSurface, formatReport } from '../src/build';
import { DEFAULT_AIRAC_DATE, paths } from './paths';

const airacDate = process.argv[2] ?? DEFAULT_AIRAC_DATE;

const out = buildSurface({
  icao: 'EGLL',
  airacDate,
  aipHtml: readFileSync(paths.aipHtml(airacDate), 'utf8'),
  osm: JSON.parse(readFileSync(paths.osmJson, 'utf8')),
});
const dataset = loadSurfaceDataset(out.dataset); // throws if the result is invalid

mkdirSync(paths.generatedDir, { recursive: true });
const datasetPath = join(paths.generatedDir, `surface-${airacDate}.json`);
const reportPath = join(paths.generatedDir, `surface-${airacDate}.report.md`);
writeFileSync(datasetPath, JSON.stringify(dataset, null, 1));
writeFileSync(reportPath, formatReport(out));
// Tells the display which dataset to load.
writeFileSync(join(paths.generatedDir, 'index.json'), JSON.stringify({ surface: `surface-${airacDate}.json` }, null, 2));

const count = (s: string) => out.checks.filter((c) => c.status === s).length;
console.log(formatReport(out).split('## OSM import warnings')[0]);
console.log(`checks: ${count('ok')} ok, ${count('warning')} warnings, ${count('error')} errors; ${out.osmWarnings.length} OSM import warnings`);
console.log(`wrote ${datasetPath}`);
console.log(`wrote ${reportPath}`);
if (count('error') > 0) process.exitCode = 1;
