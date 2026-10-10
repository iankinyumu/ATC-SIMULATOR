/** Surface display palette, modelled on the NATS tower ground display (spec §36A). */
export const COLORS = {
  background: 0x000000,
  apron: 0x34363f,
  terminal: 0x16243a,
  terminalEdge: 0x2f4f78,
  hangar: 0x1f2228,
  hangarEdge: 0x3a3f4a,
  taxiway: 0x8b8c9e,
  taxilane: 0x5f6170,
  runway: 0x4a4b52,
  runwayMarking: 0xffffff,
  standLead: 0xc9a800,
  stand: 0xffd200,
  taxiwayLabel: 0xffffff,
  runwayLabel: 0xffffff,
  holdRunway: 0xff2020,
  holdIntermediate: 0xffa000,
  holdLabel: 0xff5c5c,
  route: 0x00e5ff,
  /** Route of an instruction being composed, before it is sent. */
  preview: 0x7dff7a,
  selection: 0x00e5ff,
  /** Stand marker colours when an aircraft is selected. */
  standFits: 0x3ddc5a,
  standBusy: 0xffa000,
  standTooSmall: 0xff3b3b,
  standOccupied: 0x7a828c,
  request: 0xffb020,
} as const;

export const FONT = 'Consolas, "Cascadia Mono", "DejaVu Sans Mono", monospace';

/**
 * Pavement widths used only for drawing when the AIP publishes none for a taxiway (e.g. runway
 * access taxiways) or for unnamed apron taxilanes. Not operational values.
 */
export const DISPLAY_DEFAULT_WIDTH_M = { taxiway: 23, taxilane: 18 } as const;

/** Runway centreline dash pattern for drawing, in metres. Display convention only. */
export const CENTRELINE_DASH_M = { dash: 30, gap: 20 } as const;

/** Minimum zoom (screen px per metre) at which taxiway centrelines are drawn. */
export const TAXIWAY_CENTRELINE_MIN_SCALE = 0.8;

/** Minimum zoom (screen px per metre) at which each label class appears. */
export const LABEL_MIN_SCALE = { runway: 0, taxiway: 0.22, hold: 0.7, stand: 0.55 } as const;

/** Minimum zoom at which stand markers are drawn. */
export const STAND_MARKER_MIN_SCALE = 0.3;
