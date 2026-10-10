import { ClearanceStore, type Clearance } from '../atc/clearance';
import { HandoffStore, type Handoff } from '../atc/handoff';
import { PlayerSession } from '../atc/session';
import { BotController, type BotActions } from '../bots/botController';
import {
  estimateDurationMs,
  FrequencyChannel,
  TransmissionPriority,
  type ActiveTransmission,
  type Speaker,
  type Transmission,
  type TransmissionKind,
} from '../comms/frequency';
import { DEFAULT_PARAMETERS, type SimParameters } from '../config/parameters';
import type { Dataset, Position } from '../data/dataset';
import type { AircraftType } from '../aircraft/aircraftTypes';
import type { Command } from '../atc/commands';
import { DEFAULT_PILOT_TIMING, PilotAgent, type FlightIntent, type PilotTiming, type PilotWorld } from '../pilots/pilotAgent';
import { RequestStore, type RequestKind } from '../pilots/requests';
import { holdingReportText, initialCallText, readbackText, requestText, sayAgainText, stationName } from '../phraseology/phraseology';
import { EventLog, type SimEvent } from '../events/eventLog';
import { LocalProjection } from '../geo/geo';
import { DEFAULT_GROUND_PERFORMANCE, type GroundPerformance } from '../movement/performance';
import {
  advanceSurface,
  planPushback,
  planTaxi,
  taxiRequestFromParams,
  taxiStart,
  type Planned,
  type SurfacePhase,
  type SurfaceState,
} from '../movement/surfaceMovement';
import { Rng } from '../random/rng';
import { SurfaceGraph } from '../surface/graph';
import type { SurfaceDataset } from '../surface/surface';
import { SimClock, type GameTimeMs } from '../time/clock';
import { Scheduler } from '../time/scheduler';
import type { AircraftInit, InputResult, WorldInput } from './inputs';

export interface WorldConfig {
  readonly dataset: Dataset;
  readonly seed: number;
  readonly scenarioVersion: string;
  readonly startTimeMs: GameTimeMs;
  readonly playerPositionIds: readonly string[];
  readonly parameters?: SimParameters;
  /** Aerodrome surface; needed for ground movement. */
  readonly surface?: SurfaceDataset;
  readonly groundPerformance?: GroundPerformance;
  /** Known aircraft types; an aircraft's type designator must be one of these when given. */
  readonly aircraftTypes?: readonly AircraftType[];
  readonly pilotTiming?: PilotTiming;
}

/**
 * The single authoritative aircraft entity (spec §38). Communication, control and surface state
 * so far; flight plan and airborne state are added later.
 */
export interface Aircraft {
  readonly callsign: string;
  readonly typeDesignator: string | null;
  tunedFrequencyId: string | null;
  controllingPositionId: string | null;
  /** Resolved from `typeDesignator`, or null when no type data is known. */
  readonly type: AircraftType | null;
  /** How the aircraft is addressed and identifies itself on the radio, e.g. "SPEEDBIRD 23K". */
  readonly radioCallsign: string;
  /** What the flight intends to do on the ground (drives pilot requests), or null. */
  flight: FlightIntent | null;
  /** Position and movement on the aerodrome surface, or null when not on the surface. */
  surface: SurfaceState | null;
}

const SURFACE_COMMANDS = new Set<Command['kind']>(['pushback', 'taxi', 'holdPosition', 'continueTaxi']);

interface TransmitRequest {
  readonly frequencyId: string;
  readonly speaker: Speaker;
  readonly kind: TransmissionKind;
  readonly callsign: string | null;
  readonly text: string;
  readonly priority: number;
  readonly clearanceIds: readonly string[];
  readonly durationMs?: number;
}

const reject = (reason: string): InputResult => ({ ok: false, reason });
const accept = (...ids: string[]): InputResult => ({ ok: true, ids });

/**
 * The shared simulation world. Every controller view, the player and the bots observe and act on
 * this one instance. It changes only through `apply()` (outside inputs) and `step()` (time).
 */
export class World {
  readonly config: WorldConfig;
  readonly params: SimParameters;
  readonly clock: SimClock;
  readonly log = new EventLog();
  readonly session: PlayerSession;
  readonly clearances: ClearanceStore;
  readonly handoffs: HandoffStore;

  private readonly scheduler = new Scheduler();
  private readonly pilotRng: Rng;
  private readonly positions = new Map<string, Position>();
  private readonly channels = new Map<string, FrequencyChannel>();
  private readonly aircraft = new Map<string, Aircraft>();
  private readonly bots = new Map<string, BotController>();
  private nextTransmissionId = 1;
  /** Surface graph and the local projection all surface positions use (x east, y north, metres). */
  readonly surface: { readonly graph: SurfaceGraph; readonly projection: LocalProjection } | null;
  readonly groundPerformance: GroundPerformance;
  /** Pilot requests (pushback, taxi, stand) waiting for or answered by a controller. */
  readonly requests: RequestStore;
  private readonly pilots: PilotAgent;

  constructor(config: WorldConfig) {
    this.config = config;
    this.surface =
      config.surface === undefined
        ? null
        : { graph: new SurfaceGraph(config.surface), projection: new LocalProjection(config.surface.meta.referencePoint) };
    this.groundPerformance = config.groundPerformance ?? DEFAULT_GROUND_PERFORMANCE.value;
    this.pilots = new PilotAgent(Rng.derive(config.seed, 'pilot-agent'), config.pilotTiming ?? DEFAULT_PILOT_TIMING.value);
    this.requests = new RequestStore(
      () => this.now,
      (r, from, to, reason) =>
        this.emit({
          type: 'RequestStateChanged',
          requestId: r.id,
          callsign: r.callsign,
          kind: r.kind,
          stand: r.stand,
          from,
          to,
          ...(reason !== undefined ? { reason } : {}),
        }),
    );
    this.params = config.parameters ?? DEFAULT_PARAMETERS;
    this.clock = new SimClock(config.startTimeMs, this.params.stepMs.value);
    this.session = new PlayerSession(config.playerPositionIds, config.dataset);
    this.pilotRng = Rng.derive(config.seed, 'pilot');

    for (const f of config.dataset.frequencies) this.channels.set(f.id, new FrequencyChannel(f.id));
    for (const p of config.dataset.positions) {
      this.positions.set(p.id, p);
      if (!this.session.isPlayer(p.id)) {
        this.bots.set(p.id, new BotController(p.id, Rng.derive(config.seed, `bot:${p.id}`), this.params));
      }
    }

    this.clearances = new ClearanceStore(
      () => this.now,
      (c, from, to, reason) =>
        this.emit({
          type: 'ClearanceStateChanged',
          clearanceId: c.id,
          callsign: c.callsign,
          commandKind: c.command.kind,
          from,
          to,
          ...(reason !== undefined ? { reason } : {}),
        }),
    );
    this.handoffs = new HandoffStore(
      () => this.now,
      (h, from, to, reason) =>
        this.emit({
          type: 'HandoffStateChanged',
          handoffId: h.id,
          callsign: h.callsign,
          fromPositionId: h.fromPositionId,
          toPositionId: h.toPositionId,
          from,
          to,
          ...(reason !== undefined ? { reason } : {}),
        }),
    );

    this.emit({
      type: 'SessionStarted',
      airport: config.dataset.meta.airport,
      datasetVersion: config.dataset.meta.datasetVersion,
      scenarioVersion: config.scenarioVersion,
      seed: config.seed,
      playerPositionIds: [...config.playerPositionIds],
    });
  }

  get now(): GameTimeMs {
    return this.clock.now;
  }

  // ---------------------------------------------------------------------------------------------
  // Read access for views, bots and tests
  // ---------------------------------------------------------------------------------------------

  getAircraft(callsign: string): Readonly<Aircraft> | undefined {
    return this.aircraft.get(callsign);
  }

  allAircraft(): readonly Readonly<Aircraft>[] {
    return [...this.aircraft.values()];
  }

  getPosition(positionId: string): Position | undefined {
    return this.positions.get(positionId);
  }

  getFrequency(frequencyId: string): FrequencyChannel | undefined {
    return this.channels.get(frequencyId);
  }

  // ---------------------------------------------------------------------------------------------
  // Time
  // ---------------------------------------------------------------------------------------------

  /** Advances the simulation by one fixed step. */
  step(): void {
    const now = this.clock.tick();
    this.scheduler.runDue(now);
    for (const channel of this.channels.values()) {
      channel.update(now, {
        onStart: (a) =>
          this.emit({ type: 'TransmissionStarted', transmissionId: a.tx.id, frequencyId: a.tx.frequencyId, endsAt: a.endsAt }),
        onEnd: (a) => this.onTransmissionEnded(a),
      });
    }
    this.moveSurfaceTraffic();
    this.pilots.update(this.pilotWorld());
  }

  /** Runs whole steps covering `durationMs` of game time. */
  runFor(durationMs: number): void {
    const steps = Math.round(durationMs / this.clock.stepMs);
    for (let i = 0; i < steps; i++) this.step();
  }

  // ---------------------------------------------------------------------------------------------
  // Inputs
  // ---------------------------------------------------------------------------------------------

  /** Applies an outside input at the current game time. Every input is logged for replay. */
  apply(input: WorldInput): InputResult {
    this.emit({ type: 'Input', input: structuredClone(input) });
    const result = this.handle(input);
    if (!result.ok) this.emit({ type: 'InputRejected', inputType: input.type, reason: result.reason });
    return result;
  }

  private handle(input: WorldInput): InputResult {
    switch (input.type) {
      case 'addAircraft':
        return this.addAircraft(input.aircraft);
      case 'issueInstruction':
        return this.issueInstruction(input);
      case 'unrecognisedTransmission':
        return this.unrecognisedTransmission(input);
      case 'initiateHandoff':
        return this.initiateHandoff(input.callsign, input.fromPositionId, input.toPositionId);
      case 'acceptHandoff':
        return this.acceptHandoff(input.handoffId, input.positionId);
    }
  }

  private addAircraft(init: AircraftInit): InputResult {
    if (this.aircraft.has(init.callsign)) return reject(`Aircraft ${init.callsign} already exists`);
    if (init.tunedFrequencyId !== null && !this.channels.has(init.tunedFrequencyId)) {
      return reject(`Unknown frequency ${init.tunedFrequencyId}`);
    }
    if (init.controllingPositionId !== null && !this.positions.has(init.controllingPositionId)) {
      return reject(`Unknown position ${init.controllingPositionId}`);
    }
    let type: AircraftType | null = null;
    if (init.typeDesignator !== null && this.config.aircraftTypes !== undefined) {
      type = this.config.aircraftTypes.find((t) => t.icao === init.typeDesignator) ?? null;
      if (type === null) return reject(`Unknown aircraft type ${init.typeDesignator}`);
    }
    if ((init.standName !== undefined || init.position !== undefined) && this.surface === null) {
      return reject('Cannot place an aircraft on the surface without a surface dataset');
    }
    if (init.standName !== undefined && init.position !== undefined) return reject('Give a stand or a position, not both');

    let surface: SurfaceState | null = null;
    if (init.standName !== undefined) {
      const stand = this.surface!.graph.stand(init.standName);
      if (stand === undefined || stand.stopNodeId === null) return reject(`Unknown or unconnected stand ${init.standName}`);
      const problem = this.standProblem(stand.name, init.callsign, type);
      if (problem !== null) return reject(problem);
      const p = this.surface!.projection.toLocal(stand.position);
      surface = { phase: 'parked', x: p.x, y: p.y, headingTrueDeg: stand.headingTrueDeg ?? 0, speedMps: 0, standName: stand.name, nodeId: stand.stopNodeId, motion: null };
    } else if (init.position !== undefined) {
      const node = this.surface!.graph.node(init.position.nodeId);
      if (node === undefined) return reject(`Unknown surface node ${init.position.nodeId}`);
      const p = this.surface!.projection.toLocal(node);
      surface = { phase: 'holding', x: p.x, y: p.y, headingTrueDeg: init.position.headingTrueDeg, speedMps: 0, standName: null, nodeId: node.id, motion: null };
    }
    if (init.flight?.kind === 'arrival') {
      const problem = this.standProblem(init.flight.stand, init.callsign, type);
      if (problem !== null) return reject(`Arrival stand: ${problem}`);
    }

    const { standName: _stand, position: _position, flight, radioCallsign, ...rest } = init;
    this.aircraft.set(init.callsign, {
      ...rest,
      radioCallsign: radioCallsign ?? init.callsign,
      type,
      flight: flight === undefined ? null : { ...flight },
      surface,
    });
    this.emit({
      type: 'AircraftAdded',
      callsign: init.callsign,
      tunedFrequencyId: init.tunedFrequencyId,
      controllingPositionId: init.controllingPositionId,
    });
    if (surface !== null) {
      this.emit({ type: 'SurfacePhaseChanged', callsign: init.callsign, from: null, to: surface.phase, detail: surface.standName !== null ? `stand ${surface.standName}` : 'on taxiway' });
    }
    return accept(init.callsign);
  }

  private issueInstruction(input: Extract<WorldInput, { type: 'issueInstruction' }>): InputResult {
    const position = this.positions.get(input.positionId);
    if (position === undefined) return reject(`Unknown position ${input.positionId}`);
    if (!this.aircraft.has(input.callsign)) return reject(`Unknown aircraft ${input.callsign}`);
    if (input.commands.length === 0) return reject('An instruction needs at least one command');

    // Authority model (spec §18) and the aircraft's ability to comply — the same checks the
    // controller interfaces use to offer commands.
    for (const command of input.commands) {
      const problem = this.commandProblem(position.id, input.callsign, command);
      if (problem !== null) return reject(problem);
    }

    const clearances = input.commands.map((command) =>
      this.clearances.create(input.callsign, position.id, command, 'assigned'),
    );
    for (const command of input.commands) this.answerRequests(input.callsign, command);
    const tx = this.controllerTransmit(position, {
      kind: 'instruction',
      callsign: input.callsign,
      text: input.text,
      clearanceIds: clearances.map((c) => c.id),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    });
    return accept(tx.id, ...clearances.map((c) => c.id));
  }

  // ---------------------------------------------------------------------------------------------
  // Queries for controller interfaces (no side effects, nothing logged)
  // ---------------------------------------------------------------------------------------------

  /**
   * Why `positionId` cannot give this command to the aircraft right now, or null if it can.
   * Uses exactly the checks `issueInstruction` applies (spec §18). With `checkRoute: false`,
   * pushback/taxi are checked against the aircraft's state only (e.g. before a destination is chosen).
   */
  commandProblem(positionId: string, callsign: string, command: Command, options: { checkRoute?: boolean } = {}): string | null {
    const position = this.positions.get(positionId);
    if (position === undefined) return `Unknown position ${positionId}`;
    const aircraft = this.aircraft.get(callsign);
    if (aircraft === undefined) return `Unknown aircraft ${callsign}`;
    if (aircraft.controllingPositionId !== position.id) return `${callsign} is not under the control of ${position.id}`;
    if (!position.allowedCommands.value.includes(command.kind)) return `${command.kind} is not permitted at ${position.id}`;
    if (SURFACE_COMMANDS.has(command.kind)) return this.checkSurfaceCommand(aircraft, command, options.checkRoute ?? true);
    if (command.kind === 'frequencyChange') return this.checkFrequencyChange(callsign, position.id, command.params.toPositionId);
    return null;
  }

  /** The path a pushback or taxi command would produce, without issuing it. */
  previewSurfaceCommand(positionId: string, callsign: string, command: Command): Planned {
    const problem = this.commandProblem(positionId, callsign, command);
    if (problem !== null) return { ok: false, reason: problem };
    if (command.kind !== 'pushback' && command.kind !== 'taxi') return { ok: false, reason: `${command.kind} has no path` };
    return this.planSurface(this.aircraft.get(callsign)!, command);
  }

  /** Directions a parked aircraft can push back to face, from its stand's geometry. */
  pushbackFaces(positionId: string, callsign: string): Array<'N' | 'E' | 'S' | 'W'> {
    return (['N', 'E', 'S', 'W'] as const).filter((face) => this.commandProblem(positionId, callsign, { kind: 'pushback', params: { face } }) === null);
  }

  /** Whether a surface command can be followed from the aircraft's current state; null if it can. */
  private checkSurfaceCommand(aircraft: Aircraft, command: Command, checkRoute = true): string | null {
    const s = aircraft.surface;
    if (s === null || this.surface === null) return `${aircraft.callsign} is not on the aerodrome surface`;
    switch (command.kind) {
      case 'pushback':
        if (s.phase !== 'parked') return `${aircraft.callsign} is not parked on a stand`;
        break;
      case 'taxi':
        // Nose-in parking is used throughout EGLL (UK AIP EGLL AD 2.9), so pushback comes first.
        if (s.phase === 'parked') return `${aircraft.callsign} is parked nose-in; push back first`;
        if (s.phase === 'pushback') return `${aircraft.callsign} is still pushing back`;
        if (typeof command.params.stand === 'string') {
          const stand = this.surface.graph.stand(command.params.stand);
          if (stand !== undefined) {
            const problem = this.standProblem(stand.name, aircraft.callsign, aircraft.type);
            if (problem !== null) return problem;
          }
        }
        break;
      case 'holdPosition':
        if (s.phase !== 'taxi') return `${aircraft.callsign} is not taxiing`;
        return null;
      case 'continueTaxi':
        if (s.phase !== 'holding' || s.motion === null || s.motion.holdClearanceId === null) {
          return `${aircraft.callsign} is not holding position on a taxi route`;
        }
        return null;
      default:
        return null;
    }
    if (!checkRoute) return null;
    const plan = this.planSurface(aircraft, command);
    return plan.ok ? null : plan.reason;
  }

  private planSurface(aircraft: Aircraft, command: Command): Planned {
    const s = aircraft.surface!;
    const { graph, projection } = this.surface!;
    if (command.kind === 'pushback') {
      const stand = s.standName === null ? undefined : graph.stand(s.standName);
      if (stand === undefined) return { ok: false, reason: `${aircraft.callsign} is not on a known stand` };
      const face = typeof command.params.face === 'string' ? command.params.face : undefined;
      return planPushback(graph, projection, stand, face, this.groundPerformance);
    }
    const start = taxiStart(s);
    if (start === null) return { ok: false, reason: `${aircraft.callsign} is not on the taxi network` };
    return planTaxi(graph, projection, start, taxiRequestFromParams(command.params), this.groundPerformance);
  }

  // ---------------------------------------------------------------------------------------------
  // Stands
  // ---------------------------------------------------------------------------------------------

  /**
   * The aircraft using a stand: parked on it, taxiing to it, or an arrival assigned to it that
   * has not parked yet. Null if free.
   */
  standUser(standName: string): string | null {
    for (const a of this.aircraft.values()) {
      if (a.surface?.phase === 'parked' && a.surface.standName === standName) return a.callsign;
      if (a.surface?.motion?.toStand === standName) return a.callsign;
      if (a.flight?.kind === 'arrival' && a.flight.stand === standName && a.surface?.phase !== 'parked') return a.callsign;
    }
    return null;
  }

  /**
   * Why an aircraft cannot use a stand (too big for it, or it or an overlapping stand is used by
   * another aircraft), or null if it can.
   */
  standProblem(standName: string, callsign: string, type: AircraftType | null): string | null {
    const stand = this.surface?.graph.stand(standName);
    if (stand === undefined) return `Unknown stand ${standName}`;
    if (stand.stopNodeId === null) return `Stand ${stand.name} is not connected to the taxi network`;
    if (type !== null && stand.maxWingspanM !== null && type.wingspanM > stand.maxWingspanM) {
      return `Stand ${stand.name} is too small for a ${type.icao} (wingspan ${type.wingspanM} m, stand limit ${stand.maxWingspanM} m)`;
    }
    for (const name of [stand.name, ...stand.conflictsWith]) {
      const user = this.standUser(name);
      if (user !== null && user !== callsign) {
        return name === stand.name
          ? `Stand ${stand.name} is in use by ${user}`
          : `Stand ${stand.name} is blocked: overlapping stand ${name} is in use by ${user}`;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // Pilot requests
  // ---------------------------------------------------------------------------------------------

  /** Marks the pilot's pending request as answered when an instruction gives them what they asked for. */
  private answerRequests(callsign: string, command: Command): void {
    const answer = (kind: RequestKind, reason?: string) => {
      const r = this.requests.pendingFor(callsign, kind);
      if (r !== undefined) this.requests.transition(r.id, 'granted', reason);
    };
    if (command.kind === 'pushback') answer('pushback');
    if (command.kind === 'taxi' && typeof command.params.holdingPoint === 'string') answer('taxi');
    if (command.kind === 'taxi' && typeof command.params.stand === 'string') {
      const aircraft = this.aircraft.get(callsign)!;
      const stand = command.params.stand;
      const pending = this.requests.pendingFor(callsign, 'taxiToStand');
      answer('taxiToStand', pending !== undefined && pending.stand !== stand ? `given stand ${stand} instead of ${pending.stand}` : undefined);
      if (aircraft.flight?.kind === 'arrival') aircraft.flight.stand = stand;
    }
  }

  /** Station name of the position controlling the aircraft, as the pilot calls it. */
  private stationFor(callsign: string): string {
    const id = this.aircraft.get(callsign)?.controllingPositionId;
    const position = id == null ? undefined : this.positions.get(id);
    return position === undefined ? 'GROUND' : stationName(position.name);
  }

  private requestText(callsign: string, kind: RequestKind, stand: string | null): string {
    return requestText(kind, this.spokenCallsign(callsign), this.stationFor(callsign), stand);
  }

  /** The callsign as said on the radio. */
  private spokenCallsign(callsign: string): string {
    return this.aircraft.get(callsign)?.radioCallsign ?? callsign;
  }

  private positionName = (id: string): string | undefined => this.positions.get(id)?.name;

  private pilotCall(callsign: string, kind: TransmissionKind, text: string): void {
    const frequencyId = this.aircraft.get(callsign)?.tunedFrequencyId ?? null;
    if (frequencyId === null) return;
    this.transmit({ frequencyId, speaker: { kind: 'pilot', callsign }, kind, callsign, text, clearanceIds: [], priority: TransmissionPriority.pilotCall });
  }

  private pilotWorld(): PilotWorld {
    return {
      now: this.now,
      flights: () =>
        [...this.aircraft.values()]
          .filter((a) => a.flight !== null && a.surface !== null)
          .map((a) => ({
            callsign: a.callsign,
            flight: a.flight!,
            phase: a.surface!.phase,
            standName: a.surface!.standName,
            onFrequency:
              a.controllingPositionId !== null && a.tunedFrequencyId === this.positions.get(a.controllingPositionId)?.frequencyId,
          })),
      hasRequested: (callsign, kind) => this.requests.hasRaised(callsign, kind),
      hasClearance: (callsign, kind) => this.clearances.forAircraft(callsign).some((c) => c.command.kind === kind && c.state !== 'cancelled'),
      pendingRequests: () => this.requests.pending(),
      raiseRequest: (callsign, kind, stand) => {
        this.requests.raise(callsign, kind, stand, this.now);
        this.pilotCall(callsign, 'request', this.requestText(callsign, kind, stand));
      },
      repeatRequest: (id) => {
        const r = this.requests.get(id);
        if (r === undefined || r.state !== 'pending') return;
        r.lastCallAt = this.now;
        r.calls += 1;
        this.emit({ type: 'RequestRepeated', requestId: r.id, callsign: r.callsign, calls: r.calls });
        this.pilotCall(r.callsign, 'request', this.requestText(r.callsign, r.kind, r.stand));
      },
      reportHolding: (callsign, limit) => this.pilotCall(callsign, 'report', holdingReportText(this.spokenCallsign(callsign), limit)),
    };
  }

  private checkFrequencyChange(callsign: string, fromPositionId: string, toPositionId: unknown): string | null {
    if (typeof toPositionId !== 'string' || !this.positions.has(toPositionId)) {
      return 'frequencyChange needs a valid toPositionId';
    }
    const handoff = this.handoffs.openFor(callsign);
    if (handoff === undefined || handoff.state !== 'accepted' || handoff.fromPositionId !== fromPositionId || handoff.toPositionId !== toPositionId) {
      return `${toPositionId} has not accepted a handoff of ${callsign}`;
    }
    return null;
  }

  private unrecognisedTransmission(input: Extract<WorldInput, { type: 'unrecognisedTransmission' }>): InputResult {
    const position = this.positions.get(input.positionId);
    if (position === undefined) return reject(`Unknown position ${input.positionId}`);
    const tx = this.controllerTransmit(position, {
      kind: 'unrecognised',
      callsign: input.callsign,
      text: input.text,
      clearanceIds: [],
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    });
    return accept(tx.id);
  }

  private initiateHandoff(callsign: string, fromPositionId: string, toPositionId: string): InputResult {
    const aircraft = this.aircraft.get(callsign);
    if (aircraft === undefined) return reject(`Unknown aircraft ${callsign}`);
    if (!this.positions.has(toPositionId)) return reject(`Unknown position ${toPositionId}`);
    if (fromPositionId === toPositionId) return reject('Cannot hand off to the same position');
    if (aircraft.controllingPositionId !== fromPositionId) return reject(`${callsign} is not under the control of ${fromPositionId}`);
    if (this.handoffs.openFor(callsign) !== undefined) return reject(`${callsign} already has an open handoff`);

    const handoff = this.handoffs.initiate(callsign, fromPositionId, toPositionId);
    this.bots.get(toPositionId)?.onHandoffOffered(handoff, this.botActions());
    return accept(handoff.id);
  }

  private acceptHandoff(handoffId: string, positionId: string): InputResult {
    const handoff = this.handoffs.get(handoffId);
    if (handoff === undefined) return reject(`Unknown handoff ${handoffId}`);
    if (handoff.toPositionId !== positionId) return reject(`Handoff ${handoffId} is not offered to ${positionId}`);
    if (handoff.state !== 'initiated') return reject(`Handoff ${handoffId} is ${handoff.state}`);
    this.handoffs.transition(handoffId, 'accepted');
    return accept(handoffId);
  }

  private botActions(): BotActions {
    return {
      now: this.now,
      schedule: (at, run) => this.scheduler.schedule(at, run),
      // Bot decisions are derived from the seed, so they are logged as state changes, not inputs.
      acceptHandoff: (handoffId, positionId) => {
        const handoff = this.handoffs.get(handoffId);
        if (handoff?.state === 'initiated' && handoff.toPositionId === positionId) {
          this.handoffs.transition(handoffId, 'accepted');
        }
      },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Radio
  // ---------------------------------------------------------------------------------------------

  private controllerTransmit(
    position: Position,
    req: Omit<TransmitRequest, 'frequencyId' | 'speaker' | 'priority'>,
  ): Transmission {
    const isPlayer = this.session.isPlayer(position.id);
    const channel = this.channels.get(position.frequencyId)!;
    const wasBusy = channel.busy;
    const tx = this.transmit({
      ...req,
      frequencyId: position.frequencyId,
      speaker: { kind: 'controller', positionId: position.id },
      priority: isPlayer ? TransmissionPriority.player : TransmissionPriority.controller,
    });
    if (isPlayer && wasBusy) {
      this.emit({ type: 'FrequencyBusyViolation', frequencyId: position.frequencyId, positionId: position.id, transmissionId: tx.id });
    }
    return tx;
  }

  private transmit(req: TransmitRequest): Transmission {
    const durationMs =
      req.durationMs ?? estimateDurationMs(req.text, this.params.speechWordsPerSecond.value, this.params.minTransmissionMs.value);
    const tx: Transmission = {
      id: `TX${this.nextTransmissionId++}`,
      frequencyId: req.frequencyId,
      speaker: req.speaker,
      kind: req.kind,
      callsign: req.callsign,
      text: req.text,
      durationMs,
      priority: req.priority,
      clearanceIds: req.clearanceIds,
      requestedAt: this.now,
    };
    this.channels.get(req.frequencyId)!.enqueue(tx);
    this.emit({
      type: 'TransmissionQueued',
      transmissionId: tx.id,
      frequencyId: tx.frequencyId,
      speaker: tx.speaker,
      kind: tx.kind,
      callsign: tx.callsign,
      text: tx.text,
      durationMs: tx.durationMs,
    });
    return tx;
  }

  /** Pilot response delay (Decision D4), in whole simulation steps so it never exceeds the range. */
  private pilotDelayMs(): number {
    const { min, max } = this.params.pilotResponseDelayMs.value;
    const step = this.clock.stepMs;
    return this.pilotRng.intInclusive(Math.ceil(min / step), Math.floor(max / step)) * step;
  }

  /** The pilot transmits after the response delay, if still on that frequency by then. */
  private schedulePilotTransmission(
    callsign: string,
    frequencyId: string,
    kind: TransmissionKind,
    text: string,
    clearanceIds: readonly string[],
    priority: number,
  ): void {
    this.scheduler.schedule(this.now + this.pilotDelayMs(), () => {
      if (!this.isListening(callsign, frequencyId)) return;
      this.transmit({ frequencyId, speaker: { kind: 'pilot', callsign }, kind, callsign, text, clearanceIds, priority });
    });
  }

  private isListening(callsign: string, frequencyId: string): boolean {
    return this.aircraft.get(callsign)?.tunedFrequencyId === frequencyId;
  }

  private onTransmissionEnded({ tx }: ActiveTransmission): void {
    this.emit({ type: 'TransmissionEnded', transmissionId: tx.id, frequencyId: tx.frequencyId });

    switch (tx.kind) {
      case 'instruction': {
        for (const id of tx.clearanceIds) {
          if (this.clearances.canTransition(id, 'transmitted')) this.clearances.transition(id, 'transmitted');
        }
        if (tx.callsign !== null && this.isListening(tx.callsign, tx.frequencyId)) {
          // Placeholder text until the phraseology system builds real readbacks (spec §21).
          const commands = tx.clearanceIds.map((id) => this.clearances.get(id)?.command).filter((c): c is Command => c !== undefined);
          this.schedulePilotTransmission(tx.callsign, tx.frequencyId, 'readback', readbackText(commands, this.spokenCallsign(tx.callsign), this.positionName), tx.clearanceIds, TransmissionPriority.readback);
        }
        break;
      }
      case 'readback': {
        for (const id of tx.clearanceIds) {
          if (!this.clearances.canTransition(id, 'acknowledged')) continue; // cancelled meanwhile
          this.clearances.transition(id, 'acknowledged');
          this.applyClearance(this.clearances.transition(id, 'active'));
        }
        break;
      }
      case 'unrecognised': {
        // An unknown callsign gets no answer, as on a real frequency (spec §21A).
        if (tx.callsign !== null && this.isListening(tx.callsign, tx.frequencyId)) {
          this.schedulePilotTransmission(tx.callsign, tx.frequencyId, 'sayAgain', sayAgainText(this.spokenCallsign(tx.callsign)), [], TransmissionPriority.readback);
        }
        break;
      }
      case 'initialCall':
        this.completeHandoffOnContact(tx);
        break;
      case 'sayAgain':
        break;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Clearance effects
  // ---------------------------------------------------------------------------------------------

  /** Starts the aircraft acting on an active clearance. */
  private applyClearance(clearance: Clearance): void {
    switch (clearance.command.kind) {
      case 'frequencyChange': {
        const aircraft = this.aircraft.get(clearance.callsign)!;
        const target = this.positions.get(String(clearance.command.params.toPositionId))!;
        const from = aircraft.tunedFrequencyId;
        aircraft.tunedFrequencyId = target.frequencyId;
        this.emit({ type: 'AircraftFrequencyChanged', callsign: aircraft.callsign, from, to: target.frequencyId });

        const handoff = this.handoffs.openFor(aircraft.callsign);
        if (handoff?.state === 'accepted' && handoff.toPositionId === target.id) {
          this.handoffs.transition(handoff.id, 'communicationTransferred');
        }
        this.clearances.transition(clearance.id, 'completed');
        // Placeholder text until the phraseology system builds real initial calls (spec §21).
        this.schedulePilotTransmission(aircraft.callsign, target.frequencyId, 'initialCall', initialCallText(stationName(target.name), aircraft.radioCallsign), [], TransmissionPriority.pilotCall);
        break;
      }
      case 'pushback':
      case 'taxi':
        this.startSurfaceMovement(clearance);
        break;
      case 'holdPosition': {
        const motion = this.aircraft.get(clearance.callsign)?.surface?.motion ?? null;
        if (motion === null) this.clearances.transition(clearance.id, 'completed', 'already stopped');
        else motion.holdClearanceId = clearance.id; // completed once the aircraft has stopped
        break;
      }
      case 'continueTaxi': {
        const s = this.aircraft.get(clearance.callsign)?.surface ?? null;
        if (s?.motion != null && s.motion.holdClearanceId !== null) {
          s.motion.holdClearanceId = null;
          this.setSurfacePhase(clearance.callsign, s, 'taxi', s.motion.limit);
        }
        this.clearances.transition(clearance.id, 'completed');
        break;
      }
      default:
        // Other commands affect airborne movement, which is not implemented yet. They stay active.
        break;
    }
  }

  private startSurfaceMovement(clearance: Clearance): void {
    const aircraft = this.aircraft.get(clearance.callsign)!;
    const s = aircraft.surface;
    const problem = s === null ? 'not on the surface' : this.checkSurfaceCommand(aircraft, clearance.command);
    if (s === null || problem !== null) {
      // The situation changed between issue and readback.
      this.clearances.transition(clearance.id, 'cancelled', problem ?? undefined);
      return;
    }
    const plan = this.planSurface(aircraft, clearance.command);
    if (!plan.ok) {
      this.clearances.transition(clearance.id, 'cancelled', plan.reason);
      return;
    }
    // A new taxi clearance replaces the previous one.
    if (s.motion !== null) {
      for (const id of [s.motion.clearanceId, s.motion.holdClearanceId]) {
        if (id !== null && this.clearances.canTransition(id, 'cancelled') && this.clearances.get(id)!.state === 'active') {
          this.clearances.transition(id, 'cancelled', `superseded by ${clearance.id}`);
        }
      }
    }
    const kind = clearance.command.kind === 'pushback' ? 'pushback' : 'taxi';
    s.motion = { kind, path: plan.path, s: 0, clearanceId: clearance.id, holdClearanceId: null, limit: plan.limit, toStand: plan.toStand };
    s.standName = null;
    s.nodeId = null;
    this.setSurfacePhase(aircraft.callsign, s, kind, plan.limit, plan.path.length);
  }

  /** Moves every aircraft that is pushing back or taxiing by one step. */
  private moveSurfaceTraffic(): void {
    const dt = this.clock.stepMs / 1000;
    for (const aircraft of this.aircraft.values()) {
      const s = aircraft.surface;
      const m = s?.motion ?? null;
      if (s === null || m === null) continue;
      const arrived = advanceSurface(s, this.groundPerformance, dt);

      if (m.holdClearanceId !== null && s.speedMps === 0 && s.phase !== 'holding') {
        this.setSurfacePhase(aircraft.callsign, s, 'holding', 'holding position');
        if (this.clearances.get(m.holdClearanceId)?.state === 'active') this.clearances.transition(m.holdClearanceId, 'completed');
      }
      if (!arrived) continue;

      if (this.clearances.get(m.clearanceId)?.state === 'active') this.clearances.transition(m.clearanceId, 'completed');
      this.pilots.onMovementCompleted(aircraft.callsign, m.kind, this.now, m.limit, m.toStand !== null);
      s.motion = null;
      s.nodeId = m.path.points[m.path.points.length - 1]!.nodeId;
      if (m.toStand !== null) {
        s.standName = m.toStand;
        this.setSurfacePhase(aircraft.callsign, s, 'parked', `stand ${m.toStand}`);
      } else {
        this.setSurfacePhase(aircraft.callsign, s, 'holding', m.limit);
      }
    }
  }

  private setSurfacePhase(callsign: string, s: SurfaceState, to: SurfacePhase, detail: string | null, pathLengthM?: number): void {
    const from = s.phase;
    s.phase = to;
    this.emit({
      type: 'SurfacePhaseChanged',
      callsign,
      from,
      to,
      detail,
      ...(pathLengthM !== undefined ? { pathLengthM: Math.round(pathLengthM * 10) / 10 } : {}),
    });
  }

  private completeHandoffOnContact(tx: Transmission): void {
    if (tx.callsign === null) return;
    const handoff: Handoff | undefined = this.handoffs.openFor(tx.callsign);
    if (handoff?.state !== 'communicationTransferred') return;
    if (this.positions.get(handoff.toPositionId)?.frequencyId !== tx.frequencyId) return;

    const aircraft = this.aircraft.get(tx.callsign)!;
    const from = aircraft.controllingPositionId;
    this.handoffs.transition(handoff.id, 'completed');
    aircraft.controllingPositionId = handoff.toPositionId;
    this.emit({ type: 'ControlTransferred', callsign: aircraft.callsign, fromPositionId: from, toPositionId: handoff.toPositionId });
  }

  private emit(event: SimEvent): void {
    this.log.append(this.now, event);
  }
}
