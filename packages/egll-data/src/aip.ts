import { parseDms, type DeclaredDistances, type LatLon } from '@atc/sim-core';

/**
 * Parser for the UK eAIP HTML (NATS Aurora). Every published value is a `<span class="SD">`
 * followed by a hidden `<span class="sdParams">TABLE;FIELD;recordId</span>`, which identifies
 * exactly what the value is. This parser reads those tags rather than scraping visible text.
 */

export interface AipField {
  readonly table: string;
  /** Field name; annotation fields like `ANNOTATION:17314.eng` are reduced to `ANNOTATION`. */
  readonly field: string;
  readonly record: string;
  readonly value: string;
}

const FIELD_RE = /<span class="SD"[^>]*>([\s\S]*?)<\/span><span class="sdParams"[^>]*>([^<]*)<\/span>/g;

function decodeHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

export function parseFields(html: string): AipField[] {
  const fields: AipField[] = [];
  for (const m of html.matchAll(FIELD_RE)) {
    const parts = m[2]!.split(';');
    if (parts.length < 3) continue;
    fields.push({
      table: parts[0]!,
      field: parts[1]!.split(':')[0]!,
      record: parts[parts.length - 1]!,
      value: decodeHtml(m[1]!),
    });
  }
  return fields;
}

/** Returns the HTML of one AD 2 section, e.g. section(html, 'EGLL', '2.13'). */
export function section(html: string, icao: string, number: string): string {
  const startTag = `<div id="${icao}-AD-${number}">`;
  const start = html.indexOf(startTag);
  if (start < 0) throw new Error(`AIP section ${icao} AD ${number} not found`);
  const next = html.indexOf(`<div id="${icao}-AD-`, start + startTag.length);
  return html.slice(start, next < 0 ? undefined : next);
}

const rows = (html: string) => html.split(/<tr[\s>]/).slice(1);
const cells = (rowHtml: string) => rowHtml.split(/<td[\s>]/).slice(1);
const find = (fields: AipField[], table: string, field: string) => fields.find((f) => f.table === table && f.field === field);

function requireNumber(fields: AipField[], table: string, field: string, context: string): number {
  const f = find(fields, table, field);
  const n = f === undefined ? NaN : Number(f.value);
  if (!Number.isFinite(n)) throw new Error(`Missing or invalid ${table}.${field} in ${context}`);
  return n;
}

// -------------------------------------------------------------------------------------------------
// AD 2.12 Runway physical characteristics
// -------------------------------------------------------------------------------------------------

export interface AipRunwayEnd {
  readonly designator: string;
  /** Groups the two ends of the same runway (AIP TRWY record id). */
  readonly runwayRecord: string;
  readonly trueBearingDeg: number;
  readonly lengthM: number;
  readonly widthM: number;
  readonly threshold: LatLon;
  readonly thresholdElevationFt: number;
}

export function parseRunwayEnds(html: string, icao: string): AipRunwayEnd[] {
  const ends: AipRunwayEnd[] = [];
  for (const row of rows(section(html, icao, '2.12'))) {
    const fields = parseFields(row);
    const desig = find(fields, 'TRWY_DIRECTION', 'TXT_DESIG');
    const lat = find(fields, 'TRWY_CLINE_POINT', 'GEO_LAT');
    const lon = find(fields, 'TRWY_CLINE_POINT', 'GEO_LONG');
    if (desig === undefined || lat === undefined || lon === undefined) continue;
    const context = `AD 2.12 RWY ${desig.value}`;
    const elev = find(fields, 'TRWY_CLINE_POINT', 'VAL_ELEV');
    const lenUnit = find(fields, 'TRWY', 'UOM_DIM_RWY')?.value;
    const elevUnit = find(fields, 'TRWY_CLINE_POINT', 'UOM_DIST_VER')?.value;
    if (lenUnit !== 'M') throw new Error(`${context}: expected runway dimensions in M, got ${lenUnit}`);
    if (elevUnit !== 'FT') throw new Error(`${context}: expected threshold elevation in FT, got ${elevUnit}`);
    ends.push({
      designator: desig.value,
      runwayRecord: find(fields, 'TRWY', 'VAL_LEN')!.record,
      trueBearingDeg: Number(find(fields, 'TRWY_DIRECTION', 'VAL_TRUE_BRG')?.value.replace('°', '')),
      lengthM: requireNumber(fields, 'TRWY', 'VAL_LEN', context),
      widthM: requireNumber(fields, 'TRWY', 'VAL_WID', context),
      threshold: { lat: parseDms(lat.value), lon: parseDms(lon.value) },
      thresholdElevationFt: Number(elev?.value),
    });
  }
  for (const e of ends) {
    if (!Number.isFinite(e.trueBearingDeg) || !Number.isFinite(e.thresholdElevationFt)) {
      throw new Error(`AD 2.12 RWY ${e.designator}: missing bearing or threshold elevation`);
    }
  }
  return ends;
}

// -------------------------------------------------------------------------------------------------
// AD 2.13 Declared distances
// -------------------------------------------------------------------------------------------------

export interface AipDeclaredDistances {
  readonly designator: string;
  readonly declared: DeclaredDistances;
  /** Taxiway for an intersection take-off entry, or null for the full-length entry. */
  readonly intersectionTaxiway: string | null;
  readonly remarks: string[];
}

/** Columns of the AD 2.13 table, in published order. */
const DECLARED_COLUMNS = ['designator', 'tora', 'toda', 'asda', 'lda', 'remarks'] as const;

export function parseDeclaredDistances(html: string, icao: string): AipDeclaredDistances[] {
  const sectionHtml = section(html, icao, '2.13');
  const header = decodeHtml(sectionHtml.slice(0, sectionHtml.indexOf('</thead>')));
  const order = ['TORA', 'TODA', 'ASDA', 'LDA'].map((h) => header.indexOf(h));
  if (order.some((i) => i < 0) || order.some((v, i) => i > 0 && v < order[i - 1]!)) {
    throw new Error('AD 2.13: unexpected column order (expected TORA, TODA, ASDA, LDA)');
  }

  const result: AipDeclaredDistances[] = [];
  for (const row of rows(sectionHtml)) {
    const rowCells = cells(row).map(parseFields);
    if (rowCells.length < DECLARED_COLUMNS.length) continue;
    const desig = find(rowCells[0]!, 'TRWY_DIRECTION', 'TXT_DESIG');
    if (desig === undefined) continue;

    const distance = (column: (typeof DECLARED_COLUMNS)[number]): number | null => {
      const cell = rowCells[DECLARED_COLUMNS.indexOf(column)]!;
      const value = find(cell, 'TRWY_DIRECTION_DECL_DIST', 'VAL_DIST');
      if (value === undefined) return null;
      const unit = find(cell, 'TRWY_DIRECTION_DECL_DIST', 'UOM_DIST')?.value;
      if (unit !== 'M') throw new Error(`AD 2.13 RWY ${desig.value}: expected M, got ${unit}`);
      return Number(value.value);
    };
    const tora = distance('tora');
    const toda = distance('toda');
    const asda = distance('asda');
    if (tora === null || toda === null || asda === null) {
      throw new Error(`AD 2.13 RWY ${desig.value}: incomplete take-off distances`);
    }
    const remarks = rowCells[DECLARED_COLUMNS.indexOf('remarks')]!.filter((f) => f.field === 'ANNOTATION').map((f) => f.value);
    const intersection = remarks.map((r) => /intersection with\s+(\S+)/i.exec(r)?.[1]).find((t) => t !== undefined) ?? null;
    result.push({
      designator: desig.value,
      declared: { toraM: tora, todaM: toda, asdaM: asda, ldaM: distance('lda') },
      intersectionTaxiway: intersection,
      remarks,
    });
  }
  return result;
}

// -------------------------------------------------------------------------------------------------
// AD 2.8 Taxiways
// -------------------------------------------------------------------------------------------------

export interface AipTaxiway {
  readonly designator: string;
  readonly widthM: number;
}

export function parseTaxiways(html: string, icao: string): AipTaxiway[] {
  const fields = parseFields(section(html, icao, '2.8')).filter((f) => f.table === 'TTWY');
  const records = new Map<string, Map<string, string>>();
  for (const f of fields) {
    const rec = records.get(f.record) ?? new Map<string, string>();
    rec.set(f.field, f.value);
    records.set(f.record, rec);
  }
  const taxiways: AipTaxiway[] = [];
  for (const [record, rec] of records) {
    const designator = rec.get('TXT_DESIG');
    const width = Number(rec.get('VAL_WID'));
    if (designator === undefined || !Number.isFinite(width)) continue;
    if (rec.get('UOM_WID') !== 'M') throw new Error(`AD 2.8 taxiway record ${record}: expected width in M`);
    taxiways.push({ designator, widthM: width });
  }
  return taxiways;
}

// -------------------------------------------------------------------------------------------------
// AD 2.2 Aerodrome reference point
// -------------------------------------------------------------------------------------------------

/** Aerodrome reference point, if the AD 2.2 section publishes it in tagged form. */
export function parseReferencePoint(html: string, icao: string): LatLon | null {
  const fields = parseFields(section(html, icao, '2.2'));
  const lat = fields.find((f) => f.table === 'TAD_HP' && f.field === 'GEO_LAT');
  const lon = fields.find((f) => f.table === 'TAD_HP' && f.field === 'GEO_LONG');
  if (lat === undefined || lon === undefined) return null;
  return { lat: parseDms(lat.value), lon: parseDms(lon.value) };
}
