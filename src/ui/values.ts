// Sonuç nesnesinden bileşen / düğüm değerlerinin gösterim metinleri.
import { abs, argDeg, Complex } from '../core/complex';
import type { CompType } from '../core/circuit';
import type { AnalysisResult } from '../core/results';
import { formatEng } from '../core/units';

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

export function compDisplay(
  res: AnalysisResult,
  id: string,
  type: CompType,
  tIndex: number | null,
  acMeasure: 'rms' | 'peak',
): CompDisplay | null {
  const isSrc = type === 'V' || type === 'I';
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
  const P = V * I;
  const rows: CompDisplay['rows'] = [
    { label: 'Zaman', value: formatEng(res.t[k], 's') },
    { label: 'Gerilim v(t)', value: formatEng(V, 'V') },
    { label: 'Akım i(t)', value: formatEng(I, 'A') },
    { label: 'Anlık güç', value: formatEng(P, 'W'), hint: powerHint(P) },
  ];
  if (res.tau[id] !== undefined) rows.push({ label: 'Zaman sabiti τ', value: formatEng(res.tau[id], 's') });
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
