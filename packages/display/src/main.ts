import {
  codeLetter,
  DEFAULT_GROUND_PERFORMANCE,
  generateGroundTraffic,
  InputSchedule,
  loadAircraftTypes,
  holdingReportText,
  loadOperators,
  readbackText,
  requestText,
  stationName,
  loadDataset,
  loadSurfaceDataset,
  SurfaceGraph,
  World,
  DEFAULT_PARAMETERS,
  type Command,
  type CommandKind,
  type CommandParams,
  type HoldingPoint,
  type ParseContext,
  type Route,
  type SimSpeed,
  type Stand,
} from '@atc/sim-core';
import { Application } from 'pixi.js';
import aircraftTypesJson from '../../../data/aircraft/aircraft-types.json';
import operatorsJson from '../../../data/aircraft/operators.json';
import positionsJson from '../../../data/positions/egll-placeholder-positions.json';
import { Camera, type Point } from './camera';
import { CommandLine } from './commandLine';
import { commandMenu, renderMenu } from './commandMenu';
import { SurfaceScene } from './scene';
import { StripBay } from './strips';
import { COLORS } from './style';
import { RadioAudio } from './radioAudio';
import { SpeechInput } from './speechInput';
import { TrafficLayer } from './traffic';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The player works Ground in this demo; every other position is a bot. */
const PLAYER_POSITION = 'GND';
const START_TIME = Date.UTC(2026, 9, 1, 7, 0, 0);
const SEED = 2026;

/**
 * Demo traffic: real airlines at the terminals they use (data/aircraft/operators.json — entered
 * from knowledge, to verify). Flight numbers are generated, not real schedules. Arrivals appear at
 * holding points next to 09R/27L as if they had just vacated it — a scenario assumption, not a
 * modelled runway operation: north side for T2/T3/T5, south side for T4.
 */
const NORTH_OF_09R = ['N5W', 'N6', 'N7', 'N8'];
const SOUTH_OF_09R = ['S4W', 'S5W', 'S6', 'S7'];
const TERMINALS: Record<string, { stands: RegExp; appearAt: string[] }> = {
  T2: { stands: /^2\d\d[LR]?$/, appearAt: NORTH_OF_09R },
  T3: { stands: /^3\d\d[LR]?$/, appearAt: NORTH_OF_09R },
  T4: { stands: /^4\d\d[LR]?$/, appearAt: SOUTH_OF_09R },
  T5: { stands: /^5\d\d[LR]?$/, appearAt: NORTH_OF_09R },
};
const DEMO_TRAFFIC = {
  departures: { count: 14, readyWindowMs: { min: 20_000, max: 25 * 60_000 } },
  arrivals: { count: 16, firstAtMs: 45_000, intervalMs: { min: 70_000, max: 150_000 } },
};

async function loadSurface() {
  const index = (await (await fetch('/index.json')).json()) as { surface: string };
  return loadSurfaceDataset(await (await fetch(`/${index.surface}`)).json());
}

function formatLatLon(lat: number, lon: number): string {
  const dms = (v: number, pos: string, neg: string, degDigits: number) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const s = ((a - d) * 60 - m) * 60;
    return `${String(d).padStart(degDigits, '0')}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${v >= 0 ? pos : neg}`;
  };
  return `${dms(lat, 'N', 'S', 2)} ${dms(lon, 'E', 'W', 3)}`;
}

const clockText = (t: number) => `${new Date(t).toISOString().slice(11, 19)}Z`;
const duration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Taxiway sequence of a route, e.g. "LINK 56 › LINK 58 › A › A10E". */
function describeRoute(scene: SurfaceScene, route: Route): string {
  const names: string[] = [];
  for (const id of route.edgeIds) {
    const e = scene.edge(id)!;
    const name = e.kind === 'taxilane' ? 'apron' : e.kind === 'standLead' ? null : e.name;
    if (name !== null && names[names.length - 1] !== name) names.push(name ?? '?');
  }
  return names.join(' › ');
}

async function main() {
  const data = await loadSurface();
  const graph = new SurfaceGraph(data);
  const appEl = $('app');
  const mapEl = $<HTMLDivElement>('map');

  // ------------------------------------------------------------------ simulation
  const aircraftTypes = loadAircraftTypes(aircraftTypesJson).types;
  const world = new World({
    dataset: loadDataset(positionsJson),
    surface: data,
    aircraftTypes,
    seed: SEED,
    scenarioVersion: 'demo-ground-2',
    startTimeMs: START_TIME,
    playerPositionIds: [PLAYER_POSITION],
    parameters: {
      ...DEFAULT_PARAMETERS,
      pilotResponseDelayMs: {
        value: { min: 400, max: 1000 },
        units: 'ms game time',
        provenance: { status: 'owner-decision', note: 'Fast-paced EGLL radiotelephony response cadence' },
      },
    },
  });
  const groundFrequency = world.getPosition(PLAYER_POSITION)!.frequencyId;
  const schedule = new InputSchedule(
    generateGroundTraffic(graph, aircraftTypes, {
      ...DEMO_TRAFFIC,
      sources: loadOperators(operatorsJson)
        .filter((op) => TERMINALS[op.terminal] !== undefined)
        .map((op) => ({
          icao: op.icao,
          telephony: op.telephony,
          weight: op.weight,
          types: op.fleet,
          standFilter: (stand: Stand) => TERMINALS[op.terminal]!.stands.test(stand.name),
          appearAtHoldingPoints: TERMINALS[op.terminal]!.appearAt,
        })),
      seed: SEED,
      startTimeMs: START_TIME,
      positionId: PLAYER_POSITION,
      frequencyId: groundFrequency,
    }),
  );
  schedule.applyDue(world);

  // ------------------------------------------------------------------ rendering
  const app = new Application();
  await app.init({ background: COLORS.background, antialias: true, resizeTo: mapEl, autoDensity: true, resolution: window.devicePixelRatio });
  mapEl.prepend(app.canvas);

  const scene = new SurfaceScene(data, graph);
  const traffic = new TrafficLayer(DEFAULT_GROUND_PERFORMANCE.value.lengthM);
  scene.addWorldLayer(traffic.world);
  scene.addScreenLayer(traffic.screen);
  app.stage.addChild(scene.root);

  const render = () => {
    scene.update(camera, app.screen.width, app.screen.height);
    traffic.update(world, camera);
    updateScaleBar();
  };
  const camera = new Camera(render);
  const fit = () => {
    const b = scene.bounds();
    camera.fit(b.minX, b.minY, b.maxX, b.maxY, app.screen.width, app.screen.height);
  };

  const updateScaleBar = () => {
    const metres = 120 / camera.scale;
    const pow = 10 ** Math.floor(Math.log10(metres));
    const nice = [1, 2, 5, 10].map((k) => k * pow).filter((v) => v <= metres).pop() ?? pow;
    document.querySelector<HTMLDivElement>('#scale .bar')!.style.width = `${nice * camera.scale}px`;
    document.querySelector<HTMLDivElement>('#scale .label')!.textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
  };

  // ------------------------------------------------------------------ data tab and HUD header
  const osm = data.sources.find((s) => s.id === 'osm');
  $('hud-data').textContent = `AIRAC ${data.meta.airac ?? '—'} · placeholder controller positions`;
  $('dataset').innerHTML = `Dataset <span class="value">${escapeHtml(data.meta.datasetVersion)}</span><br>AIRAC ${data.meta.airac ?? '—'} · ${escapeHtml(osm?.version ?? '')}`;
  $('sources').innerHTML = data.sources
    .map((s) => `<div><span class="value">${escapeHtml(s.name)}</span><br>${escapeHtml(s.version)}<br>${s.provenance.status}, tier ${s.provenance.tier ?? '—'}</div>`)
    .join('<br>');

  // ------------------------------------------------------------------ side panels
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tabs button')) {
    b.addEventListener('click', () => {
      for (const other of document.querySelectorAll('#tabs button')) other.classList.toggle('on', other === b);
      for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('on', tab.id === `tab-${b.dataset.tab}`);
    });
  }
  const togglePanel = (cls: string, button: HTMLElement, open: string, closed: string) => {
    const isClosed = appEl.classList.toggle(cls);
    button.textContent = isClosed ? closed : open;
    // The canvas resizes with the grid; redraw on the next frame.
    requestAnimationFrame(render);
  };
  $('toggle-left').addEventListener('click', (e) => togglePanel('left-closed', e.currentTarget as HTMLElement, '‹', '›'));
  $('toggle-right').addEventListener('click', (e) => togglePanel('right-closed', e.currentTarget as HTMLElement, '›', '‹'));

  // ------------------------------------------------------------------ clock and speed (Decision D10)
  const speedButtons = [...document.querySelectorAll<HTMLButtonElement>('.speed button')];
  const showSpeed = () => {
    for (const b of speedButtons) {
      const v = Number(b.dataset.speed);
      b.classList.toggle('on', world.clock.paused ? v === 0 : v === world.clock.speed);
    }
  };
  const setSpeed = (v: number) => {
    if (v !== 1) radio.flush();
    if (v === 0) world.clock.pause();
    else {
      world.clock.setSpeed(v as SimSpeed);
      world.clock.resume();
    }
    showSpeed();
    showAudioState();
  };
  for (const b of speedButtons) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
  showSpeed();

  // ------------------------------------------------------------------ radio log and HUD messages
  const radioEl = $('radio');
  const hudMsgs = $('hud-msgs');
  const queued = new Map<string, { speaker: string; text: string; kind: string; txKind: string; callsign: string | null }>();
  const recent: Array<{ html: string; bad: boolean }> = [];
  let logSeq = 0;
  const pushMessage = (html: string, bad = false) => {
    recent.push({ html, bad });
    if (recent.length > 3) recent.shift();
    hudMsgs.innerHTML = recent.map((m) => `<div${m.bad ? ' class="bad"' : ''}>${m.html}</div>`).join('');
  };
  const radio = new RadioAudio();
  /** Voices only at 1× and while running; at higher speeds transmissions are text only (spec §35B). */
  const voicesNow = () => !world.clock.paused && world.clock.speed === 1;
  /** Controller text spoken with the radio callsign, e.g. "BAW23K TAXI…" → "SPEEDBIRD 23K TAXI…". */
  const spokenControllerText = (callsign: string | null, text: string) => {
    const a = callsign === null ? undefined : world.getAircraft(callsign);
    return a !== undefined && text.toUpperCase().startsWith(a.callsign) ? `${a.radioCallsign}${text.slice(a.callsign.length)}` : text;
  };
  /**
   * Pre-generates the calls each pilot is going to make (pushback request, ready for taxi, arrival
   * stand request, holding report) in the background, so they are ready when the pilot speaks.
   */
  const prepared = new Set<string>();
  const prepareUpcomingCalls = () => {
    if (!voicesNow() || !radio.enabled) return;
    for (const a of world.allAircraft()) {
      if (a.flight === null || a.surface === null || a.controllingPositionId === null) continue;
      const station = stationName(world.getPosition(a.controllingPositionId)?.name ?? 'Ground');
      const voice = radio.voiceFor({ kind: 'pilot', callsign: a.callsign });
      const calls: string[] = [];
      if (a.flight.kind === 'departure') {
        calls.push(requestText('pushback', a.radioCallsign, station, a.surface.standName), requestText('taxi', a.radioCallsign, station, null));
      } else {
        calls.push(requestText('taxiToStand', a.radioCallsign, station, a.flight.stand));
      }
      const m = a.surface.motion;
      if (m !== null && m.kind === 'taxi' && m.toStand === null) calls.push(holdingReportText(a.radioCallsign, m.limit));
      for (const text of calls) {
        if (prepared.has(`${voice}|${text}`)) continue;
        prepared.add(`${voice}|${text}`);
        radio.prepare(voice, text);
      }
    }
  };

  const updateRadio = () => {
    const entries = world.log.all();
    let added = false;
    for (; logSeq < entries.length; logSeq++) {
      const { t, event } = entries[logSeq]!;
      if (event.type === 'TransmissionQueued') {
        const speaker = event.speaker.kind === 'pilot' ? event.speaker.callsign : event.speaker.positionId;
        queued.set(event.transmissionId, { speaker, text: event.text, kind: event.speaker.kind, txKind: event.kind, callsign: event.callsign });
        // Start generating the pilot's readback while the instruction is still on the air.
        if (event.frequencyId === groundFrequency && event.kind === 'instruction' && event.callsign !== null && voicesNow()) {
          const a = world.getAircraft(event.callsign);
          const commands = world.clearances.all().filter((c) => c.callsign === event.callsign && c.state === 'assigned').map((c) => c.command);
          if (a !== undefined && commands.length > 0) {
            radio.prepare(radio.voiceFor({ kind: 'pilot', callsign: a.callsign }), readbackText(commands, a.radioCallsign, (id) => world.getPosition(id)?.name));
          }
        }
      } else if (event.type === 'TransmissionStarted' && event.frequencyId === groundFrequency) {
        const q = queued.get(event.transmissionId);
        if (q === undefined) continue;
        if (radioEl.classList.contains('hint')) {
          radioEl.classList.remove('hint');
          radioEl.innerHTML = '';
        }
        const line = document.createElement('div');
        line.className = q.txKind === 'request' ? 'request' : q.kind;
        line.innerHTML = `<span class="t">${clockText(t).slice(0, 8)}</span><span class="who">${escapeHtml(q.speaker)}</span>${escapeHtml(q.text)}`;
        radioEl.append(line);
        pushMessage(`${escapeHtml(q.speaker)}: ${escapeHtml(q.text)}`);
        if (voicesNow()) {
          if (q.kind === 'pilot') radio.play(radio.voiceFor({ kind: 'pilot', callsign: q.speaker }), q.text);
          else if (radio.speakController) radio.play(radio.voiceFor({ kind: 'controller' }), spokenControllerText(q.callsign, q.text));
        }
        added = true;
      }
    }
    if (added) radioEl.scrollTop = radioEl.scrollHeight;
    const pending = world.requests.pending().length;
    $<HTMLButtonElement>('tabs').querySelector<HTMLButtonElement>('[data-tab="radio"]')!.innerHTML = pending > 0 ? 'RADIO <span class="dot">●</span>' : 'RADIO';
  };

  const updateHud = () => {
    const onGround = world.allAircraft().filter((a) => a.surface !== null);
    const count = (phase: string) => onGround.filter((a) => a.surface!.phase === phase).length;
    const stats: Array<[string, number | string]> = [
      ['On ground', onGround.length],
      ['Requests', world.requests.pending().length],
      ['Moving', count('taxi') + count('pushback')],
      ['Holding', count('holding')],
      ['Parked', count('parked')],
      ['Session', duration(world.now - START_TIME)],
    ];
    $('hud-stats').innerHTML = stats.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
  };

  // ------------------------------------------------------------------ instructions from buttons, strips and menu
  let menuEl: HTMLDivElement | null = null;

  /** Prefetches pilot readback audio so speech is ready before the pilot transmits. */
  const prefetchReadback = (callsign: string, commands: readonly Command[]) => {
    const spokenCallsign = world.getAircraft(callsign)?.radioCallsign ?? callsign;
    const text = readbackText(commands, spokenCallsign, (id) => world.getPosition(id)?.name);
    const voice = radio.voiceFor({ kind: 'pilot', callsign });
    radio.prepare(voice, text);
  };

  /** Sends a structured command, exactly as recognised speech will later. */
  const issueFor = (callsign: string, kind: CommandKind, params: CommandParams, words: string) => {
    // The transmission text stands in for spoken words until the CAP 413 phraseology system exists (spec §21).
    const commands: Command[] = [{ kind, params }];
    if (radio.enabled) prefetchReadback(callsign, commands);
    const durationMs = radio.speakController ? undefined : 200;
    const result = world.apply({
      type: 'issueInstruction',
      positionId: PLAYER_POSITION,
      callsign,
      commands,
      text: `${callsign} ${words}`,
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
    const el = $('cmd-status');
    el.className = result.ok ? 'ok' : 'error';
    el.textContent = result.ok ? `Sent: ${callsign} ${words.toLowerCase()} — waiting for readback` : `⚠ ${result.reason} — not sent`;
    if (!result.ok) pushMessage(`${escapeHtml(callsign)}: ${escapeHtml(result.reason)}`, true);
    refreshPanels();
  };
  const issue = (kind: CommandKind, params: CommandParams, words: string) => {
    if (traffic.selected !== null) issueFor(traffic.selected, kind, params, words);
  };

  const handlers = {
    send: (kind: 'pushback' | 'holdPosition' | 'continueTaxi', params: Record<string, string>, words: string) => issue(kind, params, words),
    composeTaxi: () => commandLine.setText('TAXI HOLDING POINT '),
  };

  const closeMenu = () => {
    menuEl?.remove();
    menuEl = null;
  };

  /** Context menu for an aircraft, next to the given screen point. */
  const openMenu = (callsign: string, at: Point) => {
    closeMenu();
    const el = document.createElement('div');
    el.className = 'menu';
    const header = document.createElement('div');
    header.className = 'menu-header';
    header.textContent = callsign;
    const body = document.createElement('div');
    renderMenu(body, commandMenu(world, PLAYER_POSITION, callsign, handlers), closeMenu);
    el.append(header, body);
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    mapEl.append(el);
    el.style.left = `${Math.max(8, Math.min(at.x + 12, mapEl.clientWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(at.y + 12, mapEl.clientHeight - el.offsetHeight - 8))}px`;
    menuEl = el;
  };

  const select = (callsign: string | null) => {
    traffic.selected = callsign;
    if (callsign !== null) clearRoute();
    closeMenu();
    commandLine.refresh();
    refreshPanels();
    render();
  };

  const strips = new StripBay($('strips'), world, PLAYER_POSITION, {
    select: (cs) => select(traffic.selected === cs ? null : cs),
    send: (cs, kind, params, words) => issueFor(cs, kind, params, words),
    compose: (cs, text) => {
      if (traffic.selected !== cs) select(cs);
      commandLine.setText(text);
    },
  });

  const parseContext = (): ParseContext => ({
      callsigns: world.allAircraft().map((a) => a.callsign),
      holdingPoints: [...new Set(data.holdingPoints.map((h) => h.name).filter((n): n is string => n !== null))],
      stands: data.stands.map((s) => s.name),
      taxiways: graph.taxiwayNames(),
      runways: data.runways.map((r) => r.designator),
      defaultCallsign: traffic.selected,
      callsignAliases: Object.fromEntries(world.allAircraft().map((a) => [a.radioCallsign, a.callsign])),
    });
  const commandLine = new CommandLine($<HTMLInputElement>('cmd'), $('cmd-status'), $('cmd-target'), {
    world,
    positionId: PLAYER_POSITION,
    context: parseContext,
    onPreview: (path) => {
      traffic.previewPath = path;
      render();
    },
    onSent: () => refreshPanels(),
    transmissionDurationMs: () => (radio.speakController ? undefined : 200),
    onPreparedInstruction: (callsign, commands) => {
      if (radio.enabled) prefetchReadback(callsign, commands);
    },
  });
  $('send').addEventListener('click', () => commandLine.send());
  new SpeechInput(
    $<HTMLButtonElement>('mic'),
    $('cmd-status'),
    async (transcript) => {
      commandLine.setText(transcript);
      const status = $('cmd-status');
      status.className = 'hint';
      status.textContent = 'Asking GPT-6 Luna for a command suggestion. Review it before sending.';
      try {
        const response = await fetch('/api/interpret', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript, context: parseContext() }),
        });
        const result = (await response.json()) as { suggestion?: string; clarification?: string; error?: string };
        if (!response.ok) throw new Error(result.error ?? 'GPT-6 Luna interpretation is unavailable.');
        if (result.suggestion?.trim()) {
          commandLine.setText(result.suggestion.trim());
          if (status.className === 'ok' || status.className === 'caution') {
            status.className = 'caution';
            status.textContent = 'GPT-6 Luna suggestion. Check the parsed command and route preview, then press Enter to send.';
          } else {
            status.textContent = `GPT suggestion needs correction: ${status.textContent}`;
          }
        } else {
          commandLine.setText(transcript);
          status.className = 'caution';
          status.textContent = result.clarification || 'GPT-6 Luna could not safely map that to a supported command. Edit the transcript manually.';
        }
      } catch (error) {
        commandLine.setText(transcript);
        status.className = 'caution';
        const reason = error instanceof Error ? error.message : 'service request failed';
        status.textContent = `GPT-6 Luna unavailable (${reason}); transcript kept for manual editing.`;
      }
    },
    () => {
      const names = world.allAircraft().flatMap((a) => [a.callsign, a.radioCallsign]);
      return `UK air traffic control ground radio phraseology. Callsigns currently active: ${names.join(', ')}. Common words: taxi, holding point, stand, pushback, approved, face east, via, cross runway, hold position, continue taxi.`.slice(0, 1000);
    },
  );

  // ------------------------------------------------------------------ stand colours for the selected aircraft
  let standColorKey = '';
  const updateStandColors = () => {
    const a = traffic.selected === null ? undefined : world.getAircraft(traffic.selected);
    const colors = new Map<string, number>();
    for (const s of data.stands) {
      if (a === undefined) {
        if (world.standUser(s.name) !== null) colors.set(s.name, COLORS.standOccupied);
        continue;
      }
      const problem = world.standProblem(s.name, a.callsign, a.type);
      colors.set(s.name, problem === null ? COLORS.standFits : problem.includes('too small') ? COLORS.standTooSmall : COLORS.standBusy);
    }
    let highlight: string | null = null;
    if (a !== undefined) {
      const pending = world.requests.pendingFor(a.callsign, 'taxiToStand');
      highlight = pending?.stand ?? (a.flight?.kind === 'arrival' && a.surface?.phase !== 'parked' ? a.flight.stand : null);
    }
    const key = `${highlight}|${[...colors].map(([n, c]) => `${n}:${c}`).join(',')}`;
    if (key === standColorKey) return;
    standColorKey = key;
    scene.setStandColors(colors, highlight);
  };

  // ------------------------------------------------------------------ route tool (no aircraft selected)
  let origin: Stand | null = null;
  let destination: HoldingPoint | null = null;
  const routeEl = $('route');

  const updateRoute = () => {
    scene.selectedStand = origin;
    scene.selectedHold = destination;
    scene.route = null;
    scene.routeStart = null;
    if (origin === null) {
      routeEl.className = 'hint';
      routeEl.textContent = 'With no aircraft selected: click a stand, then a holding point.';
    } else if (destination === null) {
      routeEl.className = 'hint';
      routeEl.innerHTML = `From stand <span class="value">${origin.name}</span> — now click a holding point.`;
    } else if (origin.entryNodeId === null) {
      routeEl.className = 'warn';
      routeEl.textContent = `Stand ${origin.name} is not connected to the taxi network in the data.`;
    } else {
      const allowRunways = $<HTMLInputElement>('allow-runways').checked;
      const route = graph.findRoute({
        fromNodeId: origin.entryNodeId,
        toNodeId: destination.nodeId,
        allowedRunways: allowRunways ? data.runways.map((r) => r.designator) : [],
      });
      const label = `Stand ${origin.name} → ${destination.name ?? 'holding point'}`;
      if (route === null) {
        routeEl.className = 'warn';
        routeEl.textContent = `${label}: no route${allowRunways ? '' : ' without crossing a runway'}.`;
      } else {
        scene.route = route;
        scene.routeStart = origin;
        const crossed = new Set(route.nodeIds.flatMap((n) => graph.runwaysAt(n)));
        routeEl.className = 'route';
        routeEl.innerHTML =
          `${label}<br><span class="value">${Math.round(route.lengthM).toLocaleString('en-GB')} m</span><br>${describeRoute(scene, route)}` +
          (crossed.size > 0 ? `<br><span class="warn">Crosses ${[...crossed].join(', ')}</span>` : '');
      }
    }
    scene.refreshRoute();
  };

  function clearRoute() {
    origin = null;
    destination = null;
    updateRoute();
  }

  // ------------------------------------------------------------------ map interaction
  const infoEl = $('info');
  const describe = (hit: ReturnType<SurfaceScene['pick']>) => {
    if (hit === null) return '<span class="hint">Hover a stand or holding point.</span>';
    if ('stand' in hit) {
      const s = hit.stand;
      const size = s.maxWingspanM === null ? 'Size limit unknown' : `Max wingspan ≈ ${s.maxWingspanM} m (code ${codeLetter(s.maxWingspanM) ?? '?'}) — estimate`;
      const user = world.standUser(s.name);
      const selected = traffic.selected === null ? undefined : world.getAircraft(traffic.selected);
      const forSelected = selected === undefined ? null : world.standProblem(s.name, selected.callsign, selected.type);
      return (
        `Stand <span class="value">${s.name}</span><br>${size}<br>` +
        (s.conflictsWith.length > 0 ? `Overlaps: ${s.conflictsWith.join(', ')}<br>` : '') +
        (user !== null ? `In use by ${user}<br>` : 'Free<br>') +
        (selected !== undefined ? (forSelected === null ? `<span class="route">OK for ${selected.callsign}</span><br>` : `<span class="warn">${escapeHtml(forSelected)}</span><br>`) : '') +
        `<span class="hint">Nose-in ${s.headingTrueDeg === null ? '—' : `${s.headingTrueDeg.toFixed(0)}° T`} · OSM ${s.sourceRef ?? ''}</span>`
      );
    }
    const h = hit.hold;
    return `Holding point <span class="value">${h.name ?? '(unnamed)'}</span><br>Type: ${h.type}<br><span class="hint">OSM ${h.sourceRef ?? ''}</span>`;
  };

  camera.attach(mapEl, {
    hover: (p: Point) => {
      const ll = scene.toLatLon(camera.toWorld(p.x, p.y));
      $('cursor').textContent = formatLatLon(ll.lat, ll.lon);
      infoEl.innerHTML = describe(scene.pick(camera, p));
    },
    click: (p: Point) => {
      const aircraft = traffic.pick(world, camera, p);
      if (aircraft !== null) {
        select(aircraft);
        return;
      }
      const hit = scene.pick(camera, p);
      if (traffic.selected !== null) {
        // With an aircraft selected, clicking a holding point or stand starts a taxi instruction
        // (keeping any VIA / CROSS part already typed). Enter sends it.
        if (hit !== null && ('stand' in hit || hit.hold.name !== null)) {
          const limit = 'stand' in hit ? `STAND ${hit.stand.name}` : `HOLDING POINT ${hit.hold.name}`;
          const rest = /\b(VIA|CROSS)\b.*$/i.exec(commandLine.text)?.[0] ?? '';
          commandLine.setText(`TAXI ${limit}${rest ? ` ${rest.toUpperCase()}` : ' '}`);
        }
        return;
      }
      if (hit === null) return;
      if ('stand' in hit) {
        origin = hit.stand;
        destination = null;
      } else if (origin !== null) {
        destination = hit.hold;
      }
      updateRoute();
    },
  });

  for (const [id, cls] of [['layer-taxiways', 'taxiway'], ['layer-holds', 'hold'], ['layer-stands', 'stand']] as const) {
    $<HTMLInputElement>(id).addEventListener('change', (e) => {
      scene.labels.setEnabled(cls, (e.target as HTMLInputElement).checked);
      render();
    });
  }
  // Right-click an aircraft for its command menu; any other press on the map closes the menu.
  mapEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const r = mapEl.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const callsign = traffic.pick(world, camera, p);
    if (callsign === null) return;
    select(callsign);
    openMenu(callsign, p);
  });
  mapEl.addEventListener('pointerdown', (e) => {
    if (e.button === 0) closeMenu();
  });
  $('allow-runways').addEventListener('change', updateRoute);
  $('clear').addEventListener('click', clearRoute);
  $('fit').addEventListener('click', fit);
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'Escape') {
      closeMenu();
      select(null);
      clearRoute();
    }
    if (e.key === 'Enter' || e.key === '/') {
      e.preventDefault();
      commandLine.focus();
    }
    if (e.key === 'f' || e.key === 'F') fit();
    if (e.key === ' ') {
      e.preventDefault();
      setSpeed(world.clock.paused ? world.clock.speed : 0);
    }
  });
  app.renderer.on('resize', render);

  // Audio may only start after a user gesture.
  const audioState = $('audio-state');
  const showAudioState = () => {
    if (radio.status === null) audioState.textContent = 'VOICES: SERVER NOT RUNNING';
    else if (!radio.status.available) audioState.textContent = 'VOICES UNAVAILABLE';
    else if (!radio.unlocked) audioState.textContent = '🔈 CLICK TO ENABLE RADIO AUDIO';
    else if (!radio.enabled) audioState.textContent = 'VOICES OFF';
    else audioState.textContent = voicesNow() ? '🔊 RADIO' : '🔇 TEXT ONLY (speed)';
    audioState.className = radio.unlocked && radio.enabled && radio.status?.available === true ? 'audio on' : 'audio';
  };
  for (const type of ['pointerdown', 'keydown'] as const) {
    window.addEventListener(type, () => {
      if (radio.status?.available === true && !radio.unlocked) {
        radio.unlock();
        setTimeout(showAudioState, 100);
      }
    });
  }
  void radio.init().then((status) => {
    const el = $('voice-status');
    if (status === null) el.textContent = 'Voice server not reachable.';
    else if (!status.available) el.innerHTML = `<span class="warn">${escapeHtml(status.problem ?? 'Unavailable')}</span>`;
    else {
      const mode = status.engine === 'ElevenLabs' ? 'cloud' : 'offline';
      el.innerHTML = `${escapeHtml(status.engine)} voices ready (${mode}) · ${status.voices.length - 1} pilot voices + controller<br><span class="hint">${escapeHtml(status.attribution)}</span>`;
    }
    showAudioState();
  });
  $<HTMLInputElement>('voice-on').addEventListener('change', (e) => {
    radio.enabled = (e.target as HTMLInputElement).checked;
    if (!radio.enabled) radio.flush();
    showAudioState();
  });
  $<HTMLInputElement>('voice-filter').addEventListener('change', (e) => {
    radio.radioFilter = (e.target as HTMLInputElement).checked;
  });
  $<HTMLInputElement>('voice-controller').addEventListener('change', (e) => {
    radio.speakController = (e.target as HTMLInputElement).checked;
  });
  $<HTMLInputElement>('voice-volume').addEventListener('input', (e) => {
    radio.volume = Number((e.target as HTMLInputElement).value) / 100;
  });
  $('voice-test').addEventListener('click', () => radio.testVoices('GROUND, SPEEDBIRD 23K, RADIO CHECK'));

  // ------------------------------------------------------------------ main loop
  /** One simulation step, applying any scheduled traffic that is due first. */
  const stepWorld = () => {
    schedule.applyDue(world);
    world.step();
  };
  function refreshPanels() {
    $('clock').textContent = clockText(world.now);
    updateRadio();
    prepareUpcomingCalls();
    updateHud();
    strips.render(traffic.selected);
    updateStandColors();
    // Re-check the instruction being typed as the traffic moves (keeps any "Sent" message otherwise).
    if (commandLine.text.trim() !== '') commandLine.refresh();
  }
  let panelTimer = 0;
  app.ticker.add((ticker) => {
    const steps = world.clock.stepsForRealElapsed(ticker.deltaMS);
    for (let i = 0; i < steps; i++) stepWorld();
    traffic.update(world, camera);
    panelTimer += ticker.deltaMS;
    if (panelTimer >= 250) {
      panelTimer = 0;
      refreshPanels();
    }
  });

  fit();
  applyHash();

  /**
   * Optional start state from the URL, e.g. #view=51.4710,-0.4870,3&advance=240&select=TST201
   * (view = centre lat, lon and zoom in screen px per metre; advance = game seconds to run ahead;
   * route = stand,holding point; cmd = command line text; menu = callsign whose menu to open).
   */
  function applyHash(): void {
    const params = new URLSearchParams(location.hash.slice(1));
    const view = params.get('view')?.split(',').map(Number);
    if (view !== undefined && view.length === 3 && view.every(Number.isFinite)) {
      const [lat, lon, scale] = view as [number, number, number];
      const w = scene.toWorld({ lat, lon });
      camera.scale = scale;
      camera.x = app.screen.width / 2 - w.x * scale;
      camera.y = app.screen.height / 2 - w.y * scale;
      render();
    }
    const route = params.get('route')?.split(',');
    if (route !== undefined && route.length === 2) {
      origin = graph.stand(route[0]!) ?? null;
      destination = graph.holdingPoints(route[1]!)[0] ?? null;
      updateRoute();
    }
    // Runs first so the options below can refer to aircraft that appear during that time.
    const advance = Number(params.get('advance'));
    if (advance > 0) {
      for (let i = 0; i < (advance * 1000) / world.clock.stepMs; i++) stepWorld();
      render();
    }
    const selected = params.get('select');
    if (selected !== null && world.getAircraft(selected) !== undefined) select(selected);
    const cmd = params.get('cmd');
    if (cmd !== null) commandLine.setText(cmd);
    const menuFor = params.get('menu');
    const menuAircraft = menuFor === null ? undefined : world.getAircraft(menuFor);
    if (menuAircraft !== undefined && menuAircraft.surface !== null) {
      select(menuAircraft.callsign);
      openMenu(menuAircraft.callsign, camera.toScreen(menuAircraft.surface.x, -menuAircraft.surface.y));
    }
    refreshPanels();
  }
}

main().catch((err: unknown) => {
  document.body.innerHTML = `<pre style="color:#ff6b6b;padding:16px">Failed to start the surface display:\n${String(err)}\n\nHave you run "npm run data:fetch" and "npm run data:build"?</pre>`;
  console.error(err);
});
