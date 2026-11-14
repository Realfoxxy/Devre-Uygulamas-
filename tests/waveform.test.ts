// Aşama 5: kaynak dalga biçimleri ve enerji — beklenen değerler elle hesaplandı.
import { describe, expect, it } from 'vitest';
import { AnalysisSettings, DEFAULT_ANALYSIS, Params } from '../src/core/circuit';
import { energyBetween } from '../src/core/energy';
import type { Netlist } from '../src/core/netlist';
import type { TranResult } from '../src/core/results';
import { analyze } from '../src/solver/analyze';
import { parseNetlistText } from '../src/solver/textNetlist';
import { waveAt } from '../src/solver/waveform';

const S = (o: Partial<AnalysisSettings>): AnalysisSettings => ({ ...DEFAULT_ANALYSIS, type: 'transient', ...o });
function tran(nl: Netlist, o: Partial<AnalysisSettings> = {}) {
  const out = analyze(nl, S(o));
  if (!out.ok) throw new Error(out.issues.map((i) => i.message).join('; '));
  return out.result as TranResult;
}
/** Kaynağın parametrelerini değiştir */
function withSource(text: string, id: string, p: Params): Netlist {
  const nl = parseNetlistText(text);
  const e = nl.elements.find((x) => x.id === id)!;
  e.params = { ...p };
  return nl;
}
const at = (r: TranResult, time: number) => {
  let k = 0;
  for (let i = 0; i < r.t.length; i++) if (Math.abs(r.t[i] - time) < Math.abs(r.t[k] - time)) k = i;
  return k;
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('Kaynak dalga biçimleri', () => {
  it('1. Enerji: sabit v = 8 V, i = 25 mA → P = 0.2 W; 10 ms’de w = 2 mJ', () => {
    const r = tran(parseNetlistText('V1 1 0 DC 8\nR1 1 0 320'), { tStop: 0.02 });
    expect(r.comps.R1.V[5] * r.comps.R1.I[5]).toBeCloseTo(0.2, 12);
    expect(energyBetween(r.t, r.comps.R1.V, r.comps.R1.I, 0, 0.01)).toBeCloseTo(2e-3, 12);
    // kaynak aynı enerjiyi verir (negatif)
    expect(energyBetween(r.t, r.comps.V1.V, r.comps.V1.I, 0, 0.01)).toBeCloseTo(-2e-3, 12);
  });

  it('2. Basamak + RC: 0 → 10 V t = 0’da, R = 1 kΩ, C = 1 µF → v_C(1 ms) = 6.32 V', () => {
    const nl = withSource('V1 1 0 DC 0\nR1 1 2 1k\nC1 2 0 1u', 'V1', { mode: 'STEP', w0: 0, w1: 10, td: 0 });
    const r = tran(nl);
    expect(rel(r.comps.C1.V[at(r, 1e-3)], 6.321)).toBeLessThan(0.01);
  });

  it('basamak gecikmeli: t₀ = 2 ms kırılma noktasına adım denk gelir, öncesinde 0', () => {
    const nl = withSource('V1 1 0 DC 0\nR1 1 2 1k\nC1 2 0 1u', 'V1', { mode: 'STEP', w0: 0, w1: 10, td: 2e-3 });
    const r = tran(nl, { tStop: 6e-3 });
    expect(Array.from(r.t).some((x) => Math.abs(x - 2e-3) < 1e-15)).toBe(true);
    expect(r.comps.C1.V[at(r, 1.9e-3)]).toBeCloseTo(0, 12);
    expect(rel(r.comps.C1.V[at(r, 3e-3)], 6.321)).toBeLessThan(0.01);
  });

  it('3. Kare dalga + RLC: bobin akımı son değer 200 mA, ilk tepe t = 363 ns’de 232.6 mA (±%1)', () => {
    // 0–20 V, 2 µs açık / 2 µs kapalı; 100 Ω seri, ardından 1 nF ve 10 µH paralel
    const nl = withSource('V1 1 0 DC 0\nR1 1 2 100\nC1 2 0 1n\nL1 2 0 10u', 'V1', { mode: 'PULSE', w0: 0, w1: 20, td: 0, pw: 2e-6, per: 4e-6 });
    const r = tran(nl, { tStop: 4e-6, h: 1e-9, method: 'trap' });
    const iL = r.comps.L1.I;
    let kp = 0;
    for (let k = 0; k < r.t.length && r.t[k] < 1e-6; k++) if (iL[k] > iL[kp]) kp = k;
    expect(rel(iL[kp], 0.2326)).toBeLessThan(0.01);
    expect(Math.abs(r.t[kp] - 363e-9)).toBeLessThan(363e-9 * 0.01);
    expect(rel(iL[at(r, 2e-6)], 0.2)).toBeLessThan(0.01);
  });

  it('4. Üstel giriş: 1 Ω ∥ 1 F, i_s = 3e^(−6t)·u(t) A, v(0) = 0 → v(0.5 s) = 0.334 V (±%0.5)', () => {
    const nl = withSource('I1 0 1 DC 0\nR1 1 0 1\nC1 1 0 1', 'I1', { mode: 'EXP', wk: 3, wb: 6, td: 0 });
    const r = tran(nl, { tStop: 2, method: 'trap' });
    const exact = 0.6 * (Math.exp(-0.5) - Math.exp(-3));
    expect(rel(r.comps.C1.V[at(r, 0.5)], exact)).toBeLessThan(0.005);
    expect(exact).toBeCloseTo(0.334, 3);
  });

  it('5. PWL: 0–1 s 1 A sabit, 1–3 s 1 → 3 A doğrusal; 1 Ω’da t = 2 s’de 2 V', () => {
    const nl = withSource('I1 0 1 DC 0\nR1 1 0 1', 'I1', { mode: 'PWL', pwl: [[0, 1], [1, 1], [3, 3]] });
    const r = tran(nl, { tStop: 3 });
    expect(r.comps.R1.V[at(r, 2)]).toBeCloseTo(2, 9);
    expect(r.comps.R1.V[at(r, 0.5)]).toBeCloseTo(1, 9);
  });

  it('6. Trapezde salınım yok: basamaktan sonra v_C monoton artar ve 10 V’u aşmaz', () => {
    const nl = withSource('V1 1 0 DC 0\nR1 1 2 1k\nC1 2 0 1u', 'V1', { mode: 'STEP', w0: 0, w1: 10, td: 1e-3 });
    const r = tran(nl, { method: 'trap', tStop: 8e-3 });
    const v = r.comps.C1.V;
    for (let k = 1; k < v.length; k++) {
      expect(v[k]).toBeGreaterThanOrEqual(v[k - 1] - 1e-12);
      expect(v[k]).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it('dalga biçimi değerleri: darbe, rampa, anahtarlanan sinüs', () => {
    const pulse: Params = { mode: 'PULSE', w0: 0, w1: 5, td: 1, pw: 2, per: 5 };
    expect([0.5, 1, 2.9, 3, 6.5, 8.5].map((t) => waveAt(pulse, t))).toEqual([0, 5, 5, 0, 5, 0]);
    expect(waveAt({ mode: 'RAMP', wk: 2, td: 1 }, 3)).toBe(4);
    expect(waveAt({ mode: 'RAMP', wk: 2, td: 1 }, 0.5)).toBe(0);
    expect(waveAt({ mode: 'SINE_U', amp: 1, freq: 1, phase: 90, td: 1 }, 0.5)).toBe(0);
  });

  it('DC analiz kaynağın t < 0 değerini kullanır', () => {
    const nl = withSource('V1 1 0 DC 0\nR1 1 0 1k', 'V1', { mode: 'STEP', w0: 3, w1: 10, td: 0 });
    const out = analyze(nl, { ...DEFAULT_ANALYSIS });
    expect((out.result as { comps: Record<string, { V: number }> }).comps.R1.V).toBeCloseTo(3, 12);
    expect(out.info.join(' ')).toMatch(/t < 0/);
  });
});
