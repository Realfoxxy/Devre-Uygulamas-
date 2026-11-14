// Bağımsız kaynakların zamana bağlı değeri (Bölüm 1.2, 8.6–8.7, 9.7–9.11).
import type { Params } from '../core/circuit';
import type { NetElement } from '../core/netlist';

const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Parametrelerden t anındaki değer. */
export function waveAt(p: Params, t: number): number {
  const td = num(p.td);
  const u = t >= td ? 1 : 0;
  switch (p.mode) {
    case 'AC':
      return num(p.amp) * Math.sin(2 * Math.PI * num(p.freq) * t + (num(p.phase) * Math.PI) / 180);
    case 'STEP':
      return t < td ? num(p.w0) : num(p.w1);
    case 'PULSE': {
      const v1 = num(p.w0);
      const v2 = num(p.w1);
      const pw = Math.max(0, num(p.pw));
      const per = num(p.per);
      if (t < td) return v1;
      let x = t - td;
      if (per > 0) x = x - Math.floor(x / per + 1e-12) * per;
      return x < pw - 1e-15 ? v2 : v1;
    }
    case 'EXP':
      return u ? num(p.wk) * Math.exp(-num(p.wb) * (t - td)) : 0;
    case 'RAMP':
      return u ? num(p.wk) * (t - td) : 0;
    case 'SINE_U':
      return u ? num(p.amp) * Math.sin(2 * Math.PI * num(p.freq) * t + (num(p.phase) * Math.PI) / 180) : 0;
    case 'PWL': {
      const pts = p.pwl ?? [];
      if (!pts.length) return 0;
      if (t <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) {
        const [t1, v1] = pts[i];
        const [t0, v0] = pts[i - 1];
        if (t <= t1) return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
      }
      return pts[pts.length - 1][1];
    }
    default:
      return num(p.value);
  }
}

/** Kaynağın t anındaki değeri. */
export function sourceAt(e: NetElement, t: number): number {
  return waveAt(e.params, t);
}

/** DC analizde kullanılan değer: kaynağın t < 0 değeri (AC kaynak 0). */
export function sourceBefore(e: NetElement): number {
  if (e.params.mode === 'AC') return 0;
  return sourceAt(e, -1e-30);
}

/** Dalga biçiminin kırılma noktaları (basamak anı, darbe kenarları, PWL köşeleri) (0, tStop) aralığında. */
export function breakpoints(p: Params, tStop: number): number[] {
  const out: number[] = [];
  const td = num(p.td);
  switch (p.mode) {
    case 'STEP':
    case 'EXP':
    case 'RAMP':
    case 'SINE_U':
      out.push(td);
      break;
    case 'PULSE': {
      const pw = Math.max(0, num(p.pw));
      const per = num(p.per);
      if (per > 0) {
        const n = Math.min(10000, Math.ceil((tStop - td) / per) + 1);
        for (let k = 0; k < n; k++) out.push(td + k * per, td + k * per + pw);
      } else out.push(td, td + pw);
      break;
    }
    case 'PWL':
      for (const [t] of p.pwl ?? []) out.push(t);
      break;
  }
  return out.filter((t) => t > 1e-15 && t < tStop - 1e-15);
}

/** Dalga biçiminin karakteristik zamanları (zaman adımı ve toplam süre için) */
export function waveTimes(p: Params): { minScale: number; end: number } {
  const td = num(p.td);
  switch (p.mode) {
    case 'AC':
      return { minScale: num(p.freq) > 0 ? 1 / num(p.freq) : Infinity, end: num(p.freq) > 0 ? 5 / num(p.freq) : 0 };
    case 'SINE_U':
      return { minScale: num(p.freq) > 0 ? 1 / num(p.freq) : Infinity, end: td + (num(p.freq) > 0 ? 5 / num(p.freq) : 0) };
    case 'STEP':
      return { minScale: Infinity, end: td };
    case 'PULSE': {
      const pw = num(p.pw);
      const per = num(p.per);
      const widths = [pw, per > 0 ? per - pw : Infinity].filter((x) => x > 0);
      return { minScale: Math.min(...widths), end: td + (per > 0 ? 3 * per : 2 * pw) };
    }
    case 'EXP':
      return { minScale: num(p.wb) > 0 ? 1 / num(p.wb) : Infinity, end: td + (num(p.wb) > 0 ? 5 / num(p.wb) : 0) };
    case 'RAMP':
      return { minScale: Infinity, end: td };
    case 'PWL': {
      const pts = p.pwl ?? [];
      let min = Infinity;
      for (let i = 1; i < pts.length; i++) if (pts[i][0] > pts[i - 1][0]) min = Math.min(min, pts[i][0] - pts[i - 1][0]);
      return { minScale: min, end: pts.length ? pts[pts.length - 1][0] * 1.2 : 0 };
    }
    default:
      return { minScale: Infinity, end: 0 };
  }
}

/** Kısa açıklama (etiket ve tablolar için) */
export function waveDescription(p: Params, unit: string, fmt: (v: number, u: string) => string): string {
  const td = num(p.td);
  const at = td ? ` (t₀ = ${fmt(td, 's')})` : '';
  switch (p.mode) {
    case 'STEP':
      return `basamak ${fmt(num(p.w0), unit)} → ${fmt(num(p.w1), unit)}${at}`;
    case 'PULSE':
      return `${num(p.per) > 0 ? 'kare' : 'darbe'} ${fmt(num(p.w0), unit)}/${fmt(num(p.w1), unit)}`;
    case 'EXP':
      return `${fmt(num(p.wk), unit)}·e^(−${+num(p.wb).toPrecision(3)}t)${at}`;
    case 'RAMP':
      return `rampa ${fmt(num(p.wk), `${unit}/s`)}${at}`;
    case 'SINE_U':
      return `${fmt(num(p.amp), unit)} sin ~ ${fmt(num(p.freq), 'Hz')}${at}`;
    case 'PWL':
      return `PWL (${(p.pwl ?? []).length} nokta)`;
    default:
      return '';
  }
}
