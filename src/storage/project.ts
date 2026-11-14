// .devre proje dosyası (JSON) indirme / açma ve tarayıcıda otomatik taslak.
import { CircuitDoc, Component, CompType, DEFAULT_ANALYSIS, PARTS, Params, Wire, ctrlKindOf, isDependent } from '../core/circuit';

const DRAFT_KEY = 'devre-lab:taslak';
const REPORT_KEY = 'devre-lab:rapor-basligi';

export function serialize(doc: CircuitDoc): string {
  return JSON.stringify({ ...doc, version: FILE_VERSION }, null, 2);
}

/** Dokümandaki biçim (t_stop) ile uygulamanın biçimini (tStop) birlikte kabul eder. */
function normalizeAnalysis(a: Record<string, unknown> | undefined) {
  const out = { ...DEFAULT_ANALYSIS };
  if (!a || typeof a !== 'object') return out;
  if (a.type === 'dc' || a.type === 'ac' || a.type === 'transient') out.type = a.type;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  out.freq = num(a.freq);
  out.tStop = num(a.tStop ?? a.t_stop);
  out.h = num(a.h);
  if (typeof a.sweep === 'boolean') out.sweep = a.sweep;
  out.fStart = num(a.fStart) ?? out.fStart;
  out.fStop = num(a.fStop) ?? out.fStop;
  const ppd = num(a.pointsPerDecade);
  if (ppd) out.pointsPerDecade = Math.min(200, Math.round(ppd));
  if (a.method === 'be' || a.method === 'trap') out.method = a.method;
  if (a.acMeasure === 'rms' || a.acMeasure === 'peak') out.acMeasure = a.acMeasure;
  return out;
}

/** Uygulamanın yazdığı dosya sürümü. Eski sürümler `migrate` ile yükseltilir. */
export const FILE_VERSION = 2;
export const MAX_COMPONENTS = 500;
export const MAX_WIRES = 3000;
const ID_RE = /^[A-Za-z0-9]{1,16}$/;

/** Bileşen parametrelerinde kabul edilen alanlar (bilinmeyenler atılır). */
const NUMERIC_PARAMS = ['value', 'amp', 'freq', 'phase', 'v0', 'i0', 'gain', 'w0', 'w1', 'td', 'pw', 'per', 'wk', 'wb', 'gainA', 'rin', 'rout', 'vos', 'ib', 'vsat', 'isat', 'slew', 'pos', 'kT', 'tempC', 'vmin', 'vmax', 'rMeter'] as const;
const MODE_VALUES = ['DC', 'AC', 'STEP', 'PULSE', 'EXP', 'RAMP', 'SINE_U', 'PWL'];

class FileError extends Error {}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const coord = (v: unknown, what: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > 1e5) throw new FileError(`Dosyada geçersiz koordinat (${what}).`);
  return Math.round(n);
};

function cleanParams(type: CompType, raw: unknown): Params {
  const out: Params = { ...PARTS[type].defaultParams };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const k of NUMERIC_PARAMS) if (finite(r[k])) (out as Record<string, unknown>)[k] = r[k];
  if (typeof r.mode === 'string' && MODE_VALUES.includes(r.mode)) out.mode = r.mode as Params['mode'];
  if (r.model === 'ideal' || r.model === 'finite' || r.model === 'offset') out.model = r.model;
  if (r.way === 'A' || r.way === 'B') out.way = r.way;
  if (Array.isArray(r.pwl)) {
    const pts = (r.pwl as unknown[])
      .slice(0, 200)
      .filter((q): q is [number, number] => Array.isArray(q) && finite(q[0]) && finite(q[1]))
      .map((q) => [q[0], q[1]] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    if (pts.length) out.pwl = pts;
  }
  if (typeof r.real === 'boolean') out.real = r.real;
  if (out.pos !== undefined) out.pos = Math.min(1, Math.max(0, out.pos));
  const c = r.ctrl as Record<string, unknown> | undefined;
  if (isDependent(type) && c && typeof c === 'object' && typeof c.ref === 'string' && ID_RE.test(c.ref))
    out.ctrl = { ref: c.ref, kind: ctrlKindOf(type) };
  return out;
}

/** Eski dosya sürümlerini güncel biçime çevirir. */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let r = raw;
  // v1 → v2: bağımlı kaynaklar (E, F, G, H) eklendi; mevcut alanlar değişmedi.
  if (Number(r.version) === 1) r = { ...r, version: 2 };
  return r;
}

/**
 * .devre dosyasını okur ve doğrular. Bozuk ya da kötü niyetli dosya uygulamayı çökertmez:
 * Türkçe açıklamalı bir hata fırlatır; bilinmeyen alanlar atılır.
 */
export function deserialize(text: string): CircuitDoc {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FileError('Dosya okunamadı: geçerli bir .devre (JSON) dosyası değil.');
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.components))
    throw new FileError('Geçersiz .devre dosyası: bileşen listesi bulunamadı.');
  const version = Number(raw.version);
  if (!Number.isInteger(version) || version < 1 || version > FILE_VERSION)
    throw new FileError(`Bu dosya sürümü (${String(raw.version)}) desteklenmiyor. Uygulamayı yenileyip tekrar deneyin.`);
  raw = migrate(raw);
  const rawComps = raw.components as unknown[];
  if (rawComps.length > MAX_COMPONENTS) throw new FileError(`Dosyada çok fazla bileşen var (en fazla ${MAX_COMPONENTS}).`);
  const rawWires = Array.isArray(raw.wires) ? (raw.wires as unknown[]) : [];
  if (rawWires.length > MAX_WIRES) throw new FileError(`Dosyada çok fazla kablo var (en fazla ${MAX_WIRES}).`);

  const ids = new Set<string>();
  const components: Component[] = [];
  for (const item of rawComps) {
    const c = item as Record<string, unknown>;
    if (!c || typeof c !== 'object' || typeof c.type !== 'string' || !(c.type in PARTS)) continue;
    const id = String(c.id ?? '');
    if (!ID_RE.test(id)) throw new FileError(`Geçersiz bileşen adı “${id.slice(0, 20)}”: en fazla 16 harf/rakam olmalı.`);
    if (ids.has(id)) throw new FileError(`Aynı isimde iki bileşen var: ${id}.`);
    ids.add(id);
    const type = c.type as CompType;
    const rot = ((Math.round(Number(c.rot) / 90) * 90) % 360 + 360) % 360;
    components.push({ id, type, x: coord(c.x, id), y: coord(c.y, id), rot: Number.isFinite(rot) ? rot : 0, params: cleanParams(type, c.params) });
  }
  const wires: Wire[] = [];
  const wireIds = new Set<string>();
  rawWires.forEach((item, i) => {
    const w = item as Record<string, unknown>;
    if (!w || !Array.isArray(w.from) || !Array.isArray(w.to)) return;
    let id = typeof w.id === 'string' && ID_RE.test(w.id) ? w.id : `w${i + 1}`;
    while (wireIds.has(id)) id = `${id}x`.slice(-16);
    wireIds.add(id);
    wires.push({ id, from: [coord(w.from[0], 'kablo'), coord(w.from[1], 'kablo')], to: [coord(w.to[0], 'kablo'), coord(w.to[1], 'kablo')] });
  });

  const meta: CircuitDoc['meta'] = {};
  const m = raw.meta as Record<string, unknown> | undefined;
  if (m && typeof m === 'object') {
    if (typeof m.deney === 'string') meta.deney = m.deney.slice(0, 200);
    if (typeof m.tarih === 'string') meta.tarih = m.tarih.slice(0, 20);
  }
  const measured: CircuitDoc['measured'] = {};
  const ms = raw.measured as Record<string, unknown> | undefined;
  if (ms && typeof ms === 'object')
    for (const [k, v] of Object.entries(ms)) {
      if (!ids.has(k) || !v || typeof v !== 'object') continue;
      const vv = v as Record<string, unknown>;
      const entry: { V?: number; I?: number } = {};
      if (finite(vv.V)) entry.V = vv.V;
      if (finite(vv.I)) entry.I = vv.I;
      if (entry.V !== undefined || entry.I !== undefined) measured[k] = entry;
    }
  return { version: FILE_VERSION, meta, components, wires, analysis: normalizeAnalysis(raw.analysis as Record<string, unknown>), measured };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const TR_MAP: Record<string, string> = { ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U' };

/** Dosya adı: Türkçe harfler ASCII'ye, boşluklar tireye (her tarayıcıda güvenli). */
export function safeFileName(s: string | undefined, fallback: string) {
  const base = (s ?? '').trim() || fallback;
  const ascii = base
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) => TR_MAP[ch])
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return (ascii || fallback).slice(0, 80);
}

export function downloadProject(doc: CircuitDoc) {
  downloadBlob(new Blob([serialize(doc)], { type: 'application/json' }), `${safeFileName(doc.meta.deney, 'devre')}.devre`);
}

export function openProjectFile(): Promise<CircuitDoc | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.devre,application/json,.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try {
        resolve(deserialize(await f.text()));
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}

export function saveDraft(doc: CircuitDoc) {
  try {
    localStorage.setItem(DRAFT_KEY, serialize(doc));
  } catch {
    /* depolama kapalı olabilir */
  }
}

export function loadDraft(): CircuitDoc | null {
  try {
    const t = localStorage.getItem(DRAFT_KEY);
    return t ? deserialize(t) : null;
  } catch {
    return null;
  }
}

export interface ReportHeader {
  deney: string;
  ogrenci: string;
  numara: string;
  ders: string;
  tarih: string;
}

export function loadReportHeader(): Partial<ReportHeader> {
  try {
    return JSON.parse(localStorage.getItem(REPORT_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveReportHeader(h: ReportHeader) {
  try {
    localStorage.setItem(REPORT_KEY, JSON.stringify(h));
  } catch {
    /* yok say */
  }
}
