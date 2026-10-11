/**
 * Download only the Piper engine and voice model into data/external/voices/ for offline fallback.
 *
 *   npm run piper:fetch
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const config = JSON.parse(readFileSync(root('data/voices/voices.json'), 'utf8')) as {
  piper: { windowsBuildUrl: string; model: string; modelUrl: string; configUrl: string };
};
const dir = root('data/external/voices');

async function download(url: string, to: string): Promise<void> {
  if (existsSync(to)) {
    console.log(`already present: ${to}`);
    return;
  }
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
  console.log(`saved ${to}`);
}

// ---- Piper offline fallback
const models = join(dir, 'models');
mkdirSync(models, { recursive: true });
if (process.platform === 'win32') {
  const zip = join(dir, 'piper_windows_amd64.zip');
  await download(config.piper.windowsBuildUrl, zip);
  if (!existsSync(join(dir, 'piper', 'piper', 'piper.exe'))) {
    mkdirSync(join(dir, 'piper'), { recursive: true });
    // Windows' built-in tar can extract zip files.
    execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', join(dir, 'piper')]);
    console.log('extracted Piper');
  }
  await download(config.piper.modelUrl, join(models, config.piper.model));
  await download(config.piper.configUrl, join(models, `${config.piper.model}.json`));
} else {
  console.warn('Piper fallback: only the Windows build is fetched automatically.');
}
console.log('Voices ready.');
