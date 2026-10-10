import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { localVoicePlugin, whisperTranscriptionPlugin } from './server/voiceServer';

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const env = loadEnv(process.env.NODE_ENV ?? 'development', root('.'), '');

export default defineConfig({
  // Serve the generated EGLL datasets (data/generated/egll) as static files.
  publicDir: root('data/generated/egll'),
  server: { port: 5173 },
  plugins: [
    whisperTranscriptionPlugin(env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY),
    localVoicePlugin({
      config: root('data/voices/voices.json'),
      installDir: root('data/external/voices'),
      cacheDir: root('data/generated/audio-cache'),
    }),
  ],
});
