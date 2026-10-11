import { toSpoken } from '@atc/sim-core';

export interface VoiceStatus {
  available: boolean;
  problem: string | null;
  engine: string;
  voices: Array<{ id: string; label: string }>;
  attribution: string;
}

/** Same voice for the same callsign for the whole session. */
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * Splits a spoken call at its commas: "Ground, Speedbird two three Kilo, request pushback." →
 * ["Ground,", "Speedbird two three Kilo,", "request pushback."]. Each piece is generated and cached
 * on its own, so callsigns and common phrases are reused, and playback can start with the first.
 */
export function phrasePieces(spoken: string): string[] {
  const parts = spoken.split(/,\s*/).map((p) => p.trim()).filter((p) => p !== '');
  return parts.map((p, i) => (i < parts.length - 1 ? `${p},` : /[.!?]$/.test(p) ? p : `${p}.`));
}

/**
 * Plays radio transmissions through the configured voice provider (spec §22). Text is turned into
 * its phraseology spoken form and fetched from the server-side voice endpoint (/api/voice).
 * Transmissions play one at a time, like a real frequency.
 */
export class RadioAudio {
  enabled = true;
  /** Speak the controller's own (typed) instructions too. */
  speakController = true;
  /** Light band-limiting so voices sound like a radio; no noise or distortion. */
  radioFilter = true;
  volume = 0.85;
  status: VoiceStatus | null = null;

  private ctx: AudioContext | null = null;
  private readonly pieces = new Map<string, Promise<AudioBuffer | null>>();
  private chain: Promise<void> = Promise.resolve();
  private generation = 0;
  private pilotVoices: string[] = [];

  async init(): Promise<VoiceStatus | null> {
    try {
      this.status = (await (await fetch('/api/voice/status')).json()) as VoiceStatus;
      this.pilotVoices = this.status.voices.filter((v) => v.id.startsWith('pilot')).map((v) => v.id);
    } catch {
      this.status = null;
    }
    return this.status;
  }

  /** Browsers only allow audio after a user gesture. */
  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  unlock(): void {
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
  }

  voiceFor(speaker: { kind: 'pilot'; callsign: string } | { kind: 'controller' }): string {
    if (speaker.kind === 'controller' || this.pilotVoices.length === 0) return 'controller';
    return this.pilotVoices[hashString(speaker.callsign) % this.pilotVoices.length]!;
  }

  /** Starts generating a call in the background (e.g. a readback, or a request the pilot will make). */
  prepare(voice: string, text: string): void {
    if (!this.available) return;
    // Do not spend ElevenLabs credits on speculative calls that may never be transmitted.
    if (this.status?.engine === 'ElevenLabs') return;
    for (const piece of this.speechSegments(text)) this.piece(voice, piece, 'prefetch');
  }

  /** Plays a call after any that are already playing, each piece as soon as it is ready. */
  play(voice: string, text: string): void {
    if (!this.available || !this.enabled || !this.unlocked) return;
    const buffers = this.speechSegments(text).map((p) => this.piece(voice, p, 'now'));
    const requestedAt = performance.now();
    const generation = this.generation;
    this.chain = this.chain.then(async () => {
      for (const buffer of buffers) {
        const b = await buffer;
        // Drop calls that are badly out of step with the simulation, or flushed.
        if (b === null || generation !== this.generation || !this.enabled || performance.now() - requestedAt > 20_000) return;
        await this.playBuffer(b);
      }
      await new Promise((r) => setTimeout(r, 180)); // short break between transmissions
    });
  }

  /** Says a short phrase in every pilot voice, one after another. */
  testVoices(sample: string): void {
    this.unlock();
    for (const v of [...this.pilotVoices, 'controller']) this.play(v, sample);
  }

  /** Abandons everything queued (e.g. when the simulation speeds up and voices are muted). */
  flush(): void {
    this.generation++;
    this.chain = Promise.resolve();
  }

  private get available(): boolean {
    return this.status?.available === true;
  }

  private speechSegments(text: string): string[] {
    const spoken = toSpoken(text);
    // Cloud synthesis should receive the full call for natural phrasing and fewer paid requests.
    return this.status?.engine === 'ElevenLabs' ? [spoken] : phrasePieces(spoken);
  }

  private piece(voice: string, text: string, priority: 'now' | 'prefetch'): Promise<AudioBuffer | null> {
    const key = `${voice}|${text}`;
    const cached = this.pieces.get(key);
    if (cached !== undefined) {
      // Re-requesting with 'now' moves it ahead of background generation on the server.
      if (priority === 'now') void fetch(this.url(voice, text, 'now')).catch(() => {});
      return cached;
    }
    const buffer = fetch(this.url(voice, text, priority))
      .then(async (r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`voice ${r.status}`))))
      .then((data) => {
        this.ctx ??= new AudioContext();
        return this.ctx.decodeAudioData(data);
      })
      .catch(() => {
        this.pieces.delete(key);
        return null;
      });
    this.pieces.set(key, buffer);
    if (this.pieces.size > 600) this.pieces.delete(this.pieces.keys().next().value!);
    return buffer;
  }

  private url(voice: string, text: string, priority: 'now' | 'prefetch'): string {
    return `/api/voice/tts?voice=${encodeURIComponent(voice)}&priority=${priority}&text=${encodeURIComponent(text)}`;
  }

  private playBuffer(buffer: AudioBuffer): Promise<void> {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = this.volume;
    out.connect(ctx.destination);
    let input: AudioNode = out;
    if (this.radioFilter) {
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 200;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 5000;
      highpass.connect(lowpass).connect(out);
      input = highpass;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(input);
    source.start();
    return new Promise((resolve) => {
      source.onended = () => resolve();
    });
  }
}
