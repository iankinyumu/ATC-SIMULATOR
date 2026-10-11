import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { conversationInterpretationPlugin } from './server/conversationPlugin';
import { localVoicePlugin, whisperTranscriptionPlugin } from './server/voiceServer';

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const env = loadEnv(process.env.NODE_ENV ?? 'development', root('.'), '');

export default defineConfig({
  // Serve the generated EGLL datasets (data/generated/egll) as static files.
  publicDir: root('data/generated/egll'),
  server: { port: 5173 },
  plugins: [
    whisperTranscriptionPlugin(env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY),
    conversationInterpretationPlugin(env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY, env.OPENAI_CHAT_MODEL?.trim() || 'gpt-6-luna'),
    localVoicePlugin({
      config: root('data/voices/voices.json'),
      installDir: root('data/external/voices'),
      cacheDir: root('data/generated/audio-cache'),
    }, {
      apiKey: env.ELEVENLABS_API_KEY ?? process.env.ELEVENLABS_API_KEY,
      provider: env.VOICE_PROVIDER ?? process.env.VOICE_PROVIDER,
      modelId: env.ELEVENLABS_MODEL_ID ?? process.env.ELEVENLABS_MODEL_ID,
      pilotVoiceIds: env.ELEVENLABS_PILOT_VOICE_IDS ?? process.env.ELEVENLABS_PILOT_VOICE_IDS,
      controllerVoiceId: env.ELEVENLABS_CONTROLLER_VOICE_ID ?? process.env.ELEVENLABS_CONTROLLER_VOICE_ID,
    }),
  ],
});
