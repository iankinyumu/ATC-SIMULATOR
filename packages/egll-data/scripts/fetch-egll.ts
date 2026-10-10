/**
 * Downloads the source data for the EGLL surface dataset into data/external/ (not version-controlled).
 *
 *   npm run data:fetch [-- 2026-10-01]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_AIRAC_DATE, paths } from './paths';

const airacDate = process.argv[2] ?? DEFAULT_AIRAC_DATE;
const USER_AGENT = 'egll-atc-sim (personal, non-commercial project)';

/** Heathrow aerodrome area. */
const BBOX = '51.452,-0.505,51.488,-0.405';
const OVERPASS_QUERY = `[out:json][timeout:120];(nwr["aeroway"](${BBOX}););out body;>;out skel qt;`;
const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function save(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`saved ${path} (${(content.length / 1024).toFixed(0)} KB)`);
}

async function fetchAip(): Promise<void> {
  const url = `https://www.aurora.nats.co.uk/htmlAIP/Publications/${airacDate}-AIRAC/html/eAIP/EG-AD-2.EGLL-en-GB.html`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`AIP download failed: HTTP ${res.status} for ${url}`);
  save(paths.aipHtml(airacDate), await res.text());
}

async function fetchOsm(): Promise<void> {
  for (const server of OVERPASS_SERVERS) {
    try {
      const res = await fetch(server, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(OVERPASS_QUERY)}`,
        signal: AbortSignal.timeout(170_000),
      });
      const text = await res.text();
      if (res.ok && text.trimStart().startsWith('{')) {
        save(paths.osmJson, text);
        return;
      }
      console.warn(`${server}: HTTP ${res.status}, not JSON (server busy?)`);
    } catch (err) {
      console.warn(`${server}: ${(err as Error).message}`);
    }
  }
  throw new Error('All Overpass servers failed');
}

await fetchAip();
await fetchOsm();
