/**
 * Server-side radio speech providers. ElevenLabs is selected when its API key is configured;
 * otherwise the local Kokoro/Piper provider is used. Audio is served through Vite and cached locally.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { ElevenLabsVoiceProvider } from './elevenLabsVoice';

interface VoiceEntry {
  id: string;
  label: string;
  /** Engine voice: Kokoro voice name (e.g. "bm_george") or Piper speaker (e.g. "p226"). */
  voice: string;
}
interface EngineConfig {
  licence: string;
  attribution: string;
  pilots: VoiceEntry[];
  controller: VoiceEntry;
}
interface KokoroConfig extends EngineConfig {
  model: string;
  dtype: 'fp32' | 'fp16' | 'q8' | 'q4';
  speed: number;
}
interface PiperConfig extends EngineConfig {
  model: string;
  lengthScale: number;
}
interface VoicesFile {
  active: 'kokoro' | 'piper';
  kokoro: KokoroConfig;
  piper: PiperConfig;
}

export interface VoicePaths {
  /** data/voices/voices.json */
  config: string;
  /** data/external/voices (kokoro/, piper/, models/ inside) */
  installDir: string;
  /** Where generated .wav files are cached. */
  cacheDir: string;
}

const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;

/** Vite middleware proxying push-to-talk audio to OpenAI without exposing the API key in the browser. */
export function whisperTranscriptionPlugin(apiKey: string | undefined): Plugin {
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

  return {
    name: 'atc-openai-whisper',
    configureServer(server) {
      server.middlewares.use('/api/transcribe', (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Use POST to transcribe audio.' });
        if (!apiKey) return send(res, 503, { error: 'Set OPENAI_API_KEY to enable Whisper speech input.' });

        const contentType = req.headers['content-type'] ?? 'audio/webm';
        if (!contentType.startsWith('audio/')) return send(res, 415, { error: 'Expected an audio recording.' });
        const chunks: Buffer[] = [];
        let size = 0;
        let tooLarge = false;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_TRANSCRIPTION_BYTES) {
            tooLarge = true;
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', async () => {
          if (tooLarge) return send(res, 413, { error: 'Recording exceeds the 25 MB upload limit.' });
          if (size === 0) return send(res, 400, { error: 'The recording was empty.' });

          try {
            const audio = new Blob(chunks, { type: contentType });
            const extension = contentType.split(';')[0]!.split('/')[1]?.replace('x-', '') || 'webm';
            const form = new FormData();
            form.append('file', audio, `recording.${extension}`);
            form.append('model', 'whisper-1');
            form.append('language', 'en');
            const prompt = String(req.headers['x-transcription-prompt'] ?? '').slice(0, 1000);
            if (prompt) form.append('prompt', prompt);

            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
              method: 'POST',
              headers: { Authorization: `Bearer ${apiKey}` },
              body: form,
            });
            const result = (await response.json()) as { text?: string; error?: { message?: string } };
            if (!response.ok) return send(res, response.status, { error: result.error?.message ?? 'Whisper transcription failed.' });
            return send(res, 200, { text: result.text ?? '' });
          } catch (error) {
            return send(res, 502, { error: error instanceof Error ? error.message : 'Whisper transcription failed.' });
          }
        });
        req.on('error', () => send(res, 400, { error: 'Could not read the audio recording.' }));
      });
    },
  };
}

/** Calls about to be heard come before pre-generation. */
export type Priority = 'now' | 'prefetch';

interface Engine {
  readonly name: string;
  readonly config: EngineConfig;
  /** Changes whenever settings that affect the sound change, so cached audio is not reused. */
  readonly settingsKey: string;
  /** Why it cannot run, or null. */
  problem(): string | null;
  /** How many syntheses can run at once. */
  readonly concurrency: number;
  synth(text: string, voice: VoiceEntry, file: string): Promise<void>;
  warmUp(): void;
  stop(): void;
}

// -------------------------------------------------------------------------------------------------
// Kokoro (via kokoro-js / transformers.js, CPU)
// -------------------------------------------------------------------------------------------------

class KokoroEngine implements Engine {
  readonly name = 'Kokoro';
  readonly concurrency = 1;
  get settingsKey(): string {
    return `${this.config.model}|${this.config.dtype}|${this.config.speed}`;
  }
  private tts: Promise<{ generate(text: string, o: { voice: string; speed: number }): Promise<{ save(path: string): Promise<void> }> }> | null = null;

  constructor(
    readonly config: KokoroConfig,
    private readonly cacheDir: string,
  ) {}

  problem(): string | null {
    return existsSync(join(this.cacheDir, ...this.config.model.split('/'))) ? null : 'Kokoro voices are not downloaded. Run: npm run voices:fetch';
  }

  private load() {
    this.tts ??= (async () => {
      const { env } = await import('@huggingface/transformers');
      env.cacheDir = this.cacheDir;
      env.allowRemoteModels = false; // offline: only the downloaded files are used
      const { KokoroTTS } = await import('kokoro-js');
      return KokoroTTS.from_pretrained(this.config.model, { dtype: this.config.dtype, device: 'cpu' });
    })();
    return this.tts;
  }

  async synth(text: string, voice: VoiceEntry, file: string): Promise<void> {
    const tts = await this.load();
    const audio = await tts.generate(text, { voice: voice.voice, speed: this.config.speed });
    await audio.save(file);
  }

  warmUp(): void {
    void this.load().then((tts) => tts.generate('Ready.', { voice: this.config.controller.voice, speed: 1 }));
  }

  stop(): void {}
}

// -------------------------------------------------------------------------------------------------
// Piper (Windows build, one long-running process per worker)
// -------------------------------------------------------------------------------------------------

class PiperProcess {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly waiting: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private buffer = '';
  alive = true;

  constructor(exe: string, model: string) {
    this.proc = spawn(exe, ['--model', model, '--json-input'], { cwd: join(exe, '..') });
    this.proc.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line !== '') this.waiting.shift()?.resolve();
      }
    });
    this.proc.stderr.on('data', () => {}); // progress logging
    this.proc.on('exit', () => {
      this.alive = false;
      for (const w of this.waiting.splice(0)) w.reject(new Error('Piper exited'));
    });
  }

  synth(json: object): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      this.proc.stdin.write(`${JSON.stringify(json)}\n`);
    });
  }

  stop(): void {
    this.proc.kill();
  }
}

class PiperEngine implements Engine {
  readonly name = 'Piper';
  readonly concurrency = 2;
  get settingsKey(): string {
    return `${this.config.model}|${this.config.lengthScale}`;
  }
  private readonly exe: string;
  private readonly model: string;
  private pool: PiperProcess[] = [];
  private next = 0;
  private speakerIds: Record<string, number> | null = null;

  constructor(
    readonly config: PiperConfig,
    installDir: string,
  ) {
    this.exe = join(installDir, 'piper', 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper');
    this.model = join(installDir, 'models', config.model);
  }

  problem(): string | null {
    if (!existsSync(this.exe)) return 'Piper is not installed. Run: npm run voices:fetch';
    if (!existsSync(this.model) || !existsSync(`${this.model}.json`)) return 'Piper voice model is not downloaded. Run: npm run voices:fetch';
    return null;
  }

  async synth(text: string, voice: VoiceEntry, file: string): Promise<void> {
    this.speakerIds ??= (JSON.parse(readFileSync(`${this.model}.json`, 'utf8')) as { speaker_id_map: Record<string, number> }).speaker_id_map;
    const speakerId = this.speakerIds[voice.voice];
    if (speakerId === undefined) throw new Error(`Speaker ${voice.voice} is not in the model`);
    this.pool = this.pool.filter((p) => p.alive);
    while (this.pool.length < this.concurrency) this.pool.push(new PiperProcess(this.exe, this.model));
    const piper = this.pool[this.next++ % this.pool.length]!;
    await piper.synth({ text, speaker_id: speakerId, length_scale: this.config.lengthScale, output_file: file.replace(/\\/g, '/') });
  }

  warmUp(): void {}

  stop(): void {
    for (const p of this.pool) p.stop();
    this.pool = [];
  }
}

// -------------------------------------------------------------------------------------------------
// Voices: cache, de-duplication and a two-lane priority queue
// -------------------------------------------------------------------------------------------------

interface Job {
  readonly key: string;
  priority: Priority;
  readonly run: () => Promise<void>;
  readonly done: Promise<void>;
  resolve(): void;
  reject(e: Error): void;
}

export class LocalVoices {
  private readonly engine: Engine;
  private readonly jobs = new Map<string, Job>();
  private readonly queue: Job[] = [];
  private running = 0;

  constructor(private readonly paths: VoicePaths) {
    const file = JSON.parse(readFileSync(paths.config, 'utf8')) as VoicesFile;
    this.engine = file.active === 'piper' ? new PiperEngine(file.piper, paths.installDir) : new KokoroEngine(file.kokoro, join(paths.installDir, 'kokoro'));
    if (this.engine.problem() === null) this.engine.warmUp();
  }

  status() {
    const problem = this.engine.problem();
    return {
      available: problem === null,
      problem,
      engine: this.engine.name,
      voices: [...this.engine.config.pilots, this.engine.config.controller].map((v) => ({ id: v.id, label: v.label })),
      attribution: this.engine.config.attribution,
      queued: this.queue.length,
    };
  }

  /** Path of a .wav for the text in the given voice: cached, or generated in priority order. */
  async speak(voiceId: string, rawText: string, priority: Priority): Promise<string> {
    const problem = this.engine.problem();
    if (problem !== null) throw new Error(problem);
    const voice = [...this.engine.config.pilots, this.engine.config.controller].find((v) => v.id === voiceId);
    if (voice === undefined) throw new Error(`Unknown voice ${voiceId}`);
    const text = rawText.replace(/[^\p{L}\p{N}\s,.'?!-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (text === '') throw new Error('Nothing to say');

    const key = createHash('sha1').update(`${this.engine.name}|${this.engine.settingsKey}|${voice.voice}|${text}`).digest('hex');
    mkdirSync(this.paths.cacheDir, { recursive: true });
    const file = join(this.paths.cacheDir, `${key}.wav`);
    if (existsSync(file)) return file;

    const existing = this.jobs.get(key);
    if (existing !== undefined) {
      // A call about to be heard jumps ahead of pre-generation.
      if (priority === 'now' && existing.priority === 'prefetch') {
        existing.priority = 'now';
        this.sortQueue();
      }
      await existing.done;
      return file;
    }

    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const done = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const job: Job = { key, priority, run: () => this.engine.synth(text, voice, file), done, resolve, reject };
    this.jobs.set(key, job);
    this.queue.push(job);
    this.sortQueue();
    this.pump();
    await done;
    return file;
  }

  private sortQueue(): void {
    // Stable: 'now' jobs first, otherwise first come first served.
    const order = new Map(this.queue.map((j, i) => [j, i]));
    this.queue.sort((a, b) => (a.priority === b.priority ? order.get(a)! - order.get(b)! : a.priority === 'now' ? -1 : 1));
  }

  private pump(): void {
    while (this.running < this.engine.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running++;
      job
        .run()
        .then(() => job.resolve(), (e: Error) => job.reject(e))
        .finally(() => {
          this.jobs.delete(job.key);
          this.running--;
          this.pump();
        });
    }
  }

  stop(): void {
    this.engine.stop();
  }
}

/** Vite plugin serving GET /api/voice/status and GET /api/voice/tts?voice=…&text=…&priority=now|prefetch */
export interface VoiceProviderOptions {
  apiKey?: string;
  provider?: string;
  modelId?: string;
  pilotVoiceIds?: string;
  controllerVoiceId?: string;
}

export function localVoicePlugin(paths: VoicePaths, options: VoiceProviderOptions = {}): Plugin {
  let voices: LocalVoices | null = null;
  let elevenLabs: ElevenLabsVoiceProvider | null = null;
  const useElevenLabs = options.provider !== 'local' && Boolean(options.apiKey);
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  return {
    name: 'atc-radio-voice',
    configureServer(server) {
      if (useElevenLabs) {
        elevenLabs = new ElevenLabsVoiceProvider({
          apiKey: options.apiKey!,
          modelId: options.modelId || 'eleven_multilingual_v2',
          pilotVoiceIds: options.pilotVoiceIds,
          controllerVoiceId: options.controllerVoiceId,
          cacheDir: paths.cacheDir,
        });
      } else {
        voices = new LocalVoices(paths);
      }
      server.httpServer?.on('close', () => voices?.stop());
      server.middlewares.use('/api/voice', (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/status') {
          if (elevenLabs !== null) {
            void elevenLabs.status().then((status) => send(res, status.available ? 200 : 503, status));
            return;
          }
          return send(res, 200, voices!.status());
        }
        if (url.pathname !== '/tts') return send(res, 404, { error: 'Not found' });
        if (req.method !== 'GET') return send(res, 405, { error: 'Use GET to synthesize speech.' });
        const priority: Priority = url.searchParams.get('priority') === 'prefetch' ? 'prefetch' : 'now';
        if (elevenLabs !== null) {
          elevenLabs
            .speak(url.searchParams.get('voice') ?? '', url.searchParams.get('text') ?? '')
            .then((audio) => {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'audio/mpeg');
              res.setHeader('Cache-Control', 'max-age=31536000, immutable');
              res.end(audio);
            })
            .catch((err: Error) => send(res, 503, { error: err.message }));
          return;
        }
        voices!
          .speak(url.searchParams.get('voice') ?? '', url.searchParams.get('text') ?? '', priority)
          .then((file) => {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'audio/wav');
            res.setHeader('Cache-Control', 'max-age=86400');
            res.end(readFileSync(file));
          })
          .catch((err: Error) => send(res, 503, { error: err.message }));
      });
    },
  };
}
