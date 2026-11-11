// .devre proje dosyası (JSON) indirme / açma ve tarayıcıda otomatik taslak.
import { CircuitDoc, DEFAULT_ANALYSIS, PARTS } from '../core/circuit';

const DRAFT_KEY = 'devre-lab:taslak';
const REPORT_KEY = 'devre-lab:rapor-basligi';

export function serialize(doc: CircuitDoc): string {
  return JSON.stringify(doc, null, 2);
}

/** Dokümandaki biçim (t_stop) ile uygulamanın biçimini (tStop) birlikte kabul eder. */
function normalizeAnalysis(a: Record<string, unknown> | undefined) {
  const out = { ...DEFAULT_ANALYSIS, ...(a ?? {}) } as typeof DEFAULT_ANALYSIS & Record<string, unknown>;
  if (a && a.t_stop !== undefined && a.tStop === undefined) out.tStop = (a.t_stop as number) ?? null;
  delete out.t_stop;
  if (!['dc', 'ac', 'transient'].includes(out.type)) out.type = 'dc';
  return out as typeof DEFAULT_ANALYSIS;
}

export function deserialize(text: string): CircuitDoc {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.components)) throw new Error('Geçersiz .devre dosyası');
  if (raw.version !== 1) throw new Error(`Desteklenmeyen dosya sürümü: ${raw.version}`);
  const components = raw.components
    .filter((c: { type: string }) => c && c.type in PARTS)
    .map((c: { id: string; type: keyof typeof PARTS; x: number; y: number; rot?: number; params?: object }) => ({
      id: String(c.id),
      type: c.type,
      x: Math.round(Number(c.x) || 0),
      y: Math.round(Number(c.y) || 0),
      rot: Number(c.rot) || 0,
      params: { ...PARTS[c.type].defaultParams, ...(c.params ?? {}) },
    }));
  const wires = (raw.wires ?? []).map((w: { id?: string; from: [number, number]; to: [number, number] }, i: number) => ({
    id: w.id ?? `w${i + 1}`,
    from: [Math.round(w.from[0]), Math.round(w.from[1])],
    to: [Math.round(w.to[0]), Math.round(w.to[1])],
  }));
  return {
    version: 1,
    meta: raw.meta ?? {},
    components,
    wires,
    analysis: normalizeAnalysis(raw.analysis),
    measured: raw.measured ?? {},
  };
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
