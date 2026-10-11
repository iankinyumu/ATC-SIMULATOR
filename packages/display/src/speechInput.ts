/** Push-to-talk speech input, transcribed by the server-side OpenAI Whisper proxy. */
export class SpeechInput {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly status: HTMLElement,
    private readonly onTranscript: (text: string) => void | Promise<void>,
    private readonly prompt: () => string,
  ) {
    button.addEventListener('click', () => {
      if (this.recorder?.state === 'recording') this.stop();
      else void this.start();
    });
  }

  private async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.showError('Microphone recording is not supported by this browser.');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      this.recorder = new MediaRecorder(this.stream);
      this.recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      });
      this.recorder.addEventListener('stop', () => void this.transcribe());
      this.recorder.start();
      this.button.textContent = 'STOP';
      this.button.classList.add('recording');
      this.status.className = 'hint';
      this.status.textContent = 'Listening… click STOP when you finish speaking.';
    } catch (error) {
      this.release();
      this.showError(error instanceof Error ? error.message : 'Could not access the microphone.');
    }
  }

  private stop(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.button.textContent = 'MIC';
    this.button.classList.remove('recording');
    this.status.className = 'hint';
    this.status.textContent = 'Transcribing with OpenAI Whisper…';
  }

  private async transcribe(): Promise<void> {
    const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || 'audio/webm' });
    this.release();
    if (blob.size === 0) {
      this.showError('No audio was recorded.');
      return;
    }
    try {
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/webm', 'X-Transcription-Prompt': this.prompt() },
        body: blob,
      });
      const result = (await response.json()) as { text?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Transcription failed.');
      const text = result.text?.trim() ?? '';
      if (!text) throw new Error('Whisper did not detect any speech.');
      this.status.className = 'hint';
      this.status.textContent = 'Transcript received.';
      await this.onTranscript(text);
    } catch (error) {
      this.showError(error instanceof Error ? error.message : 'Transcription failed.');
    }
  }

  private release(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.button.textContent = 'MIC';
    this.button.classList.remove('recording');
  }

  private showError(message: string): void {
    this.status.className = 'error';
    this.status.textContent = `Speech input: ${message}`;
  }
}
