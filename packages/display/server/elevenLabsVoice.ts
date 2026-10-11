import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface RemoteVoice {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
}

interface VoicesResponse {
  voices?: RemoteVoice[];
  detail?: string | { message?: string };
}

interface VoiceEntry {
  id: string;
  label: string;
  voice: string;
}

export interface ElevenLabsOptions {
  apiKey: string;
  modelId: string;
  pilotVoiceIds?: string;
  controllerVoiceId?: string;
  cacheDir: string;
}

export class ElevenLabsVoiceProvider {
  readonly engine = 'ElevenLabs';
  private entries: VoiceEntry[] = [];
  private loadPromise: Promise<void> | null = null;
  private readonly inFlight = new Map<string, Promise<Buffer>>();

  constructor(private readonly options: ElevenLabsOptions) {}

  async status() {
    try {
      await this.loadVoices();
      return {
        available: true,
        problem: null,
        engine: this.engine,
        voices: this.entries.map(({ id, label }) => ({ id, label })),
        attribution: 'Voice names and voice selection provided by your ElevenLabs account.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load ElevenLabs voices.';
      return {
        available: false,
        problem: message,
        engine: this.engine,
        voices: [],
        attribution: '',
      };
    }
  }

  async speak(logicalVoiceId: string, rawText: string): Promise<Buffer> {
    await this.loadVoices();
    const entry = this.entries.find((voice) => voice.id === logicalVoiceId);
    if (entry === undefined) throw new Error(`Unknown voice ${logicalVoiceId}`);
    const text = rawText.replace(/[^\p{L}\p{N}\s,.'?!-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (text === '') throw new Error('Nothing to say');

    const hash = createHash('sha256').update(`${this.options.modelId}|${entry.voice}|0.55|0.8|${text}`).digest('hex');
    mkdirSync(this.options.cacheDir, { recursive: true });
    const file = join(this.options.cacheDir, `${hash}.mp3`);
    if (existsSync(file)) return readFileSync(file);

    const active = this.inFlight.get(hash);
    if (active !== undefined) return active;
    const work = this.generate(text, entry.voice, file);
    this.inFlight.set(hash, work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(hash);
    }
  }

  private loadVoices(): Promise<void> {
    this.loadPromise ??= this.fetchVoices();
    return this.loadPromise;
  }

  private async fetchVoices(): Promise<void> {
    const url = new URL('https://api.elevenlabs.io/v2/voices');
    url.searchParams.set('category', 'premade');
    url.searchParams.set('language', 'en');
    url.searchParams.set('page_size', '100');
    url.searchParams.set('include_total_count', 'false');
    const response = await fetch(url, {
      headers: { 'xi-api-key': this.options.apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json()) as VoicesResponse;
    if (!response.ok) {
      const detail = typeof body.detail === 'string' ? body.detail : body.detail?.message;
      throw new Error(detail ?? `ElevenLabs voice lookup failed (${response.status}).`);
    }
    const available = (body.voices ?? []).filter((voice) => voice.voice_id && voice.name).sort((a, b) => a.name.localeCompare(b.name));
    const byId = new Map(available.map((voice) => [voice.voice_id, voice]));
    const requestedPilotIds = (this.options.pilotVoiceIds ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    const requestedControllerId = this.options.controllerVoiceId?.trim();
    const missingIds = [...requestedPilotIds, ...(requestedControllerId ? [requestedControllerId] : [])].filter((id) => !byId.has(id));
    if (missingIds.length > 0) throw new Error('Configured ElevenLabs voice IDs must be available English premade voices in this account.');

    const controller = requestedControllerId ? byId.get(requestedControllerId)! : available.at(-1);
    if (controller !== undefined && requestedPilotIds.includes(controller.voice_id)) {
      throw new Error('Choose a different ElevenLabs voice for the controller and pilots.');
    }
    const pilots =
      requestedPilotIds.length > 0
        ? requestedPilotIds.map((id) => byId.get(id)!)
        : available.filter((voice) => voice.voice_id !== controller?.voice_id).slice(0, 10);
    if (controller === undefined || pilots.length === 0) throw new Error('ElevenLabs returned too few English premade voices for pilots and controller.');

    this.entries = [
      ...pilots.map((voice, index) => ({ id: `pilot-${index + 1}`, label: `${voice.name}${voice.labels?.accent ? ` (${voice.labels.accent})` : ''}`, voice: voice.voice_id })),
      { id: 'controller', label: `Controller - ${controller.name}`, voice: controller.voice_id },
    ];
  }

  private async generate(text: string, voiceId: string, file: string): Promise<Buffer> {
    const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
    url.searchParams.set('output_format', 'mp3_44100_128');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': this.options.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: this.options.modelId,
        voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      let message = `ElevenLabs speech generation failed (${response.status}).`;
      try {
        const body = JSON.parse(bytes.toString('utf8')) as { detail?: { message?: string } | string; message?: string };
        message = (typeof body.detail === 'string' ? body.detail : body.detail?.message) ?? body.message ?? message;
      } catch {
        // Keep the generic response when the provider does not return JSON.
      }
      throw new Error(message);
    }
    writeFileSync(file, bytes);
    return bytes;
  }
}
