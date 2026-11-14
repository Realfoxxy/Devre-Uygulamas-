// Sonuç nesnesinden bileşen / düğüm değerlerinin gösterim metinleri.
import { abs, argDeg, Complex } from '../core/complex';
import { CompType, Params, isSource } from '../core/circuit';
import type { AnalysisResult } from '../core/results';
import { formatEng } from '../core/units';
import { instPower } from '../core/energy';

export interface CompDisplay {
  rows: { label: string; value: string; hint?: string }[];
  /** Ölçülen değerle karşılaştırılacak hesaplanan büyüklükler */
  cmpV: number | null;
  cmpI: number | null;
  /** Kısa etiket (ipucu, grafik) */
  short: string;
  /** Pasif işaret kuralına göre akımın + uçtan girip girmediği */
  currentSign: number;
  currentText: string;
}

export const phasorText = (z: Complex, unit: string) => `${formatEng(abs(z), unit)} ∠ ${fmtDeg(argDeg(z))}`;
export const fmtDeg = (d: number) => `${(Math.abs(d) < 0.05 ? 0 : d).toFixed(1).replace('-', '−')}°`;

export function stepIndex(res: AnalysisResult, tIndex: number | null): number {
  if (res.kind !== 'transient') return 0;
  const last = res.t.length - 1;
  return tIndex === null ? last : Math.max(0, Math.min(last, tIndex));
}

/** Üç uçlu elemanın pin gerilimleri (seçili anda) */
export function pinVoltages(res: AnalysisResult, id: string, tIndex: number | null): Complex[] | null {
  if (res.kind === 'dc') return res.comps[id]?.pinV?.map((v) => ({ re: v, im: 0 })) ?? null;
  if (res.kind === 'ac') return res.comps[id]?.pinV ?? null;
  const k = stepIndex(res, tIndex);
  return res.comps[id]?.pinV?.map((a) => ({ re: a[k], im: 0 })) ?? null;
}

export function compDisplay(
  res: AnalysisResult,
  id: string,
  type: CompType,
  tIndex: number | null,
  acMeasure: 'rms' | 'peak',
  params?: Params,
): CompDisplay | null {
  const d = baseDisplay(res, id, type, tIndex, acMeasure);
  if (!d) return null;
  const vt = (z: Complex, u: string) => (res.kind === 'ac' ? phasorText(z, u) : formatEng(z.re, u));
  const pv = pinVoltages(res, id, tIndex);
  if (type === 'OA' && pv) {
    const vi = compVI(res, id, tIndex)!;
    d.rows = [
      ...(res.kind === 'transient' ? d.rows.slice(0, 1) : []),
      { label: 'v₊ (+ giriş)', value: vt(pv[0], 'V') },
      { label: 'v₋ (− giriş)', value: vt(pv[1], 'V') },
      { label: 'Çıkış gerilimi', value: vt(pv[2], 'V') },
      { label: 'Çıkış akımı', value: vt(vi.I, 'A'), hint: 'op-amp çıkışından devreye' },
    ];
    const model = params?.model ?? 'ideal';
    if (model === 'ideal') d.rows.push({ label: 'İdeal op-amp', value: 'v₊ = v₋ (sanal kısa devre), i₊ = i₋ = 0' });
    else if (model === 'offset') d.rows.push({ label: 'Ofsetli op-amp', value: 'v₊ − v₋ = −V_os, girişlerde I_b' });
  }
  // Bölüm 2.3: aktif / pasif ve pasif işaret kuralına göre güç
  if (type !== 'GND' && type !== 'VM' && type !== 'AM') {
    const active = ['V', 'I', 'E', 'F', 'G', 'H', 'OA', 'TS'].includes(type);
    const pRow = d.rows.find((r) => /güç/i.test(r.label));
    const pNum = res.kind === 'dc' ? res.comps[id]?.P : res.kind === 'ac' ? res.comps[id]?.P : res.comps[id] ? instPower(res.comps[id], stepIndex(res, tIndex)) : 0;
    d.rows.push({
      label: 'Eleman',
      value: `${active ? 'aktif' : 'pasif'}${pRow && pNum !== undefined && Math.abs(pNum) > 1e-15 ? ` — güç ${pNum > 0 ? 'soğuruyor' : 'veriyor'}` : ''}`,
      hint: active ? 'enerji verebilir (Bölüm 2.3)' : 'yalnızca enerji soğurur ya da depolar',
    });
  }
  if ((type === 'C' || type === 'L') && params?.value && res.kind !== 'ac') {
    const vi = compVI(res, id, tIndex)!;
    const val = Number(params.value);
    const w = type === 'C' ? 0.5 * val * vi.V.re ** 2 : 0.5 * val * vi.I.re ** 2;
    d.rows.push({ label: 'Depolanan enerji', value: formatEng(w, 'J'), hint: type === 'C' ? '½Cv²' : '½Li²' });
  }
  if (type === 'POT' && pv) d.rows.push({ label: 'Orta uç gerilimi', value: vt(pv[2], 'V'), hint: 'toprağa göre' });
  if (type === 'SW2' && params) {
    const times = params.times ?? [];
    const curT = res.kind === 'transient' ? res.t[stepIndex(res, tIndex)] : -1;
    const toggles = res.kind === 'transient' ? times.filter((x) => x <= curT + 1e-15).length : times.filter((x) => x < 0).length;
    const w0 = params.way ?? 'A';
    const way = toggles % 2 === 0 ? w0 : w0 === 'A' ? 'B' : 'A';
    d.rows.push({ label: 'Konum', value: `ortak uç → ${way}` });
  }
  if ((type === 'VM' || type === 'AM') && res.kind === 'dc' && res.idealMeters?.[id] !== undefined) {
    const ideal = res.idealMeters[id];
    const real = type === 'VM' ? res.comps[id].V : res.comps[id].I;
    const err = Math.abs(ideal) > 1e-15 ? (Math.abs(real - ideal) / Math.abs(ideal)) * 100 : 0;
    d.rows.push(
      { label: 'İdeal alet ölçerdi', value: formatEng(ideal, type === 'VM' ? 'V' : 'A') },
      { label: 'Yükleme hatası', value: `%${err.toPrecision(3)}`, hint: 'aletin iç direnci devreyi değiştiriyor' },
    );
  }
  return d;
}

function baseDisplay(
  res: AnalysisResult,
  id: string,
  type: CompType,
  tIndex: number | null,
  acMeasure: 'rms' | 'peak',
): CompDisplay | null {
  const isSrc = isSource(type);
  const powerHint = (P: number) => (isSrc && P < -1e-15 ? '(güç veriyor)' : undefined);
  if (res.kind === 'dc') {
    const c = res.comps[id];
    if (!c) return null;
    return {
      rows: [
        { label: 'Gerilim', value: formatEng(c.V, 'V') },
        { label: 'Akım', value: formatEng(c.I, 'A') },
        { label: 'Güç', value: formatEng(c.P, 'W'), hint: powerHint(c.P) },
      ],
      cmpV: c.V,
      cmpI: c.I,
      short: `${formatEng(c.V, 'V')}, ${formatEng(c.I, 'A')}`,
      currentSign: Math.sign(c.I),
      currentText: formatEng(Math.abs(c.I), 'A'),
    };
  }
  if (res.kind === 'ac') {
    const c = res.comps[id];
    if (!c) return null;
    const rows: CompDisplay['rows'] = [
      { label: 'Gerilim (tepe)', value: phasorText(c.V, 'V') },
      { label: 'Gerilim (etkin)', value: formatEng(abs(c.V) / Math.SQRT2, 'V') },
      { label: 'Akım (tepe)', value: phasorText(c.I, 'A') },
      { label: 'Akım (etkin)', value: formatEng(abs(c.I) / Math.SQRT2, 'A') },
    ];
    if (c.Z) {
      const im = c.Z.im;
      rows.push({
        label: 'Empedans',
        value: `${formatEng(c.Z.re, 'Ω')} ${im < 0 ? '−' : '+'} j${formatEng(Math.abs(im), 'Ω')}`,
        hint: phasorText(c.Z, 'Ω'),
      });
    }
    rows.push({ label: 'Ortalama güç', value: formatEng(c.P, 'W'), hint: powerHint(c.P) });
    const k = acMeasure === 'rms' ? Math.SQRT1_2 : 1;
    return {
      rows,
      cmpV: abs(c.V) * k,
      cmpI: abs(c.I) * k,
      short: `${phasorText(c.V, 'V')}`,
      currentSign: 1,
      currentText: phasorText(c.I, 'A'),
    };
  }
  const c = res.comps[id];
  if (!c) return null;
  const k = stepIndex(res, tIndex);
  const V = c.V[k];
  const I = c.I[k];
  const P = instPower(c, k);
  const rows: CompDisplay['rows'] = [
    { label: 'Zaman', value: formatEng(res.t[k], 's') },
    { label: 'Gerilim v(t)', value: formatEng(V, 'V') },
    { label: 'Akım i(t)', value: formatEng(I, 'A') },
    { label: 'Anlık güç', value: formatEng(P, 'W'), hint: powerHint(P) },
  ];
  // τ yalnızca birinci derece devrede anlamlı
  if (res.tau[id] !== undefined && !res.secondOrder) rows.push({ label: 'Zaman sabiti τ', value: formatEng(res.tau[id], 's') });
  return {
    rows,
    cmpV: V,
    cmpI: I,
    short: `${formatEng(V, 'V')}, ${formatEng(I, 'A')}`,
    currentSign: Math.sign(I),
    currentText: formatEng(Math.abs(I), 'A'),
  };
}

export function nodeText(res: AnalysisResult, node: number, tIndex: number | null): string {
  if (res.kind === 'dc') return formatEng(res.nodeV[node] ?? 0, 'V');
  if (res.kind === 'ac') return phasorText(res.nodeV[node], 'V');
  return formatEng(res.nodeV[node]?.[stepIndex(res, tIndex)] ?? 0, 'V');
}

/** Bileşenin (seçili andaki) gerilim ve akımı karmaşık sayı olarak (DC / geçici: sanal kısım 0). */
export function compVI(res: AnalysisResult, id: string, tIndex: number | null): { V: Complex; I: Complex } | null {
  if (res.kind === 'dc') {
    const c = res.comps[id];
    return c ? { V: { re: c.V, im: 0 }, I: { re: c.I, im: 0 } } : null;
  }
  if (res.kind === 'ac') {
    const c = res.comps[id];
    return c ? { V: c.V, I: c.I } : null;
  }
  const c = res.comps[id];
  if (!c) return null;
  const k = stepIndex(res, tIndex);
  return { V: { re: c.V[k], im: 0 }, I: { re: c.I[k], im: 0 } };
}

/** Gerilim ya da akım değeri: AC'de fazör, diğerlerinde sayı */
export function valueText(res: AnalysisResult, z: Complex, unit: string): string {
  return res.kind === 'ac' ? phasorText(z, unit) : formatEng(z.re, unit);
}
