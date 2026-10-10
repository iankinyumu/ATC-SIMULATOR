import { parseInstruction, type Command, type ParseContext, type Path, type World } from '@atc/sim-core';

export interface CommandLineOptions {
  readonly world: World;
  readonly positionId: string;
  /** Names the parser may recognise; called on every keystroke so it reflects the current traffic. */
  readonly context: () => ParseContext;
  /** Route preview for the instruction being typed (null to clear). */
  readonly onPreview: (path: Path | null) => void;
  /** Called after an instruction has been transmitted. */
  readonly onSent: () => void;
  /** Transmission duration override in ms (e.g. 200 ms if controller voice is not spoken). */
  readonly transmissionDurationMs?: () => number | undefined;
  /** Called before issuing an instruction to allow background preparation (e.g. prefetching audio). */
  readonly onPreparedInstruction?: (callsign: string, commands: readonly Command[]) => void;
}

const HINT = 'Type an instruction, e.g. SPEEDBIRD 23K TAXI HOLDING POINT A10E VIA A   ·   Enter to send';

/**
 * A route is flagged when it is far longer than the straight-line distance, which usually means
 * the instruction sends the aircraft the long way round (e.g. a junction it cannot turn into).
 * Display heuristic only; not an operational rule.
 */
function isDetour(path: Path): boolean {
  const a = path.points[0]!;
  const b = path.points[path.points.length - 1]!;
  const direct = Math.hypot(b.x - a.x, b.y - a.y);
  return path.length > 2000 && path.length > 3 * Math.max(direct, 300);
}

/**
 * Typed instruction input — the secondary control to speech. Text goes through the same parser
 * speech recognition will use, and is checked against the world before it can be sent.
 */
export class CommandLine {
  private readonly history: string[] = [];
  private historyIndex = 0;

  constructor(
    private readonly input: HTMLInputElement,
    private readonly status: HTMLElement,
    private readonly target: HTMLElement,
    private readonly opts: CommandLineOptions,
  ) {
    input.addEventListener('input', () => this.refresh());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.send();
      } else if (e.key === 'Escape') {
        input.value = '';
        input.blur();
        this.refresh();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.history.length === 0) return;
        this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + (e.key === 'ArrowUp' ? -1 : 1)));
        input.value = this.history[this.historyIndex] ?? '';
        this.refresh();
      }
      e.stopPropagation(); // keep map shortcuts (F, Space) out of the text box
    });
    this.refresh();
  }

  /** Replaces the text (e.g. from a menu or a map click) and focuses the input. */
  setText(text: string): void {
    this.input.value = text;
    this.input.focus();
    this.input.setSelectionRange(text.length, text.length);
    this.refresh();
  }

  get text(): string {
    return this.input.value;
  }

  focus(): void {
    this.input.focus();
  }

  /** Re-evaluates the current text (call when the selection or traffic changes). */
  refresh(): void {
    const ctx = this.opts.context();
    this.target.textContent = ctx.defaultCallsign != null ? `${ctx.defaultCallsign} ›` : '›';
    const text = this.input.value.trim();
    if (text === '') {
      this.show('hint', HINT);
      this.opts.onPreview(null);
      return;
    }
    const parsed = parseInstruction(text, ctx);
    if (!parsed.ok) {
      this.show('error', `✗ ${parsed.error}`);
      this.opts.onPreview(null);
      return;
    }
    let preview: Path | null = null;
    for (const command of parsed.commands) {
      const problem = this.opts.world.commandProblem(this.opts.positionId, parsed.callsign, command);
      if (problem !== null) {
        this.show('error', `⚠ ${parsed.summary} — ${problem}`);
        this.opts.onPreview(null);
        return;
      }
      if (command.kind === 'pushback' || command.kind === 'taxi') {
        const plan = this.opts.world.previewSurfaceCommand(this.opts.positionId, parsed.callsign, command);
        if (plan.ok) preview = plan.path;
      }
    }
    const length = preview === null ? '' : ` — ${Math.round(preview.length).toLocaleString('en-GB')} m`;
    if (preview !== null && isDetour(preview)) {
      this.show('caution', `⚠ ${parsed.summary}${length} — much longer than the direct distance; check the route   ·   Enter to send anyway`);
    } else {
      this.show('ok', `✓ ${parsed.summary}${length}   ·   Enter to send`);
    }
    this.opts.onPreview(preview);
  }

  /** Parses, checks and transmits the current text (Enter or the SEND button). */
  send(): void {
    const text = this.input.value.trim();
    if (text === '') return;
    const parsed = parseInstruction(text, this.opts.context());
    if (!parsed.ok) {
      this.show('error', `✗ ${parsed.error} — not sent`);
      return;
    }
    // The transmission text is what the controller "said": their words, as speech will provide.
    const spoken = text.toUpperCase().startsWith(parsed.callsign.toUpperCase()) ? text.toUpperCase() : `${parsed.callsign} ${text.toUpperCase()}`;
    const durationMs = this.opts.transmissionDurationMs?.();
    this.opts.onPreparedInstruction?.(parsed.callsign, parsed.commands);
    const result = this.opts.world.apply({
      type: 'issueInstruction',
      positionId: this.opts.positionId,
      callsign: parsed.callsign,
      commands: parsed.commands,
      text: spoken,
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
    if (!result.ok) {
      this.show('error', `⚠ ${result.reason} — not sent`);
      return;
    }
    this.history.push(text);
    this.historyIndex = this.history.length;
    this.input.value = '';
    this.opts.onPreview(null);
    this.show('ok', `Sent: ${parsed.summary} — waiting for readback`);
    this.opts.onSent();
  }

  private show(kind: 'hint' | 'ok' | 'caution' | 'error', message: string): void {
    this.status.className = kind;
    this.status.textContent = message;
  }
}
