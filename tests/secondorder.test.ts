// Aşama 7: ikinci derece devreler — beklenen değerler elle hesaplandı.
import { describe, expect, it } from 'vitest';
import { AnalysisSettings, DEFAULT_ANALYSIS } from '../src/core/circuit';
import type { TranResult } from '../src/core/results';
import { analyze } from '../src/solver/analyze';
import { responseEval, secondOrderAnalysis } from '../src/solver/methods/secondOrder';
import { parseNetlistText } from '../src/solver/textNetlist';

const S = (o: Partial<AnalysisSettings> = {}): AnalysisSettings => ({ ...DEFAULT_ANALYSIS, type: 'transient', ...o });
const so = (t: string) => secondOrderAnalysis(parseNetlistText(t));

describe('İkinci derece devreler', () => {
  it('1. Seri RLC: L = 10 mH, C = 1 µF → ω₀ = 10 000; R = 400 aşırı, 200 kritik, 100 az sönümlü (ω_d = 8660)', () => {
    const series = (R: number) => so(`V1 1 0 DC 10\nR1 1 2 ${R}\nL1 2 3 10m\nC1 3 0 1u`);
    const a = series(400);
    expect(a.order).toBe(2);
    expect(a.omega0).toBeCloseTo(10000, 6);
    expect(a.alpha).toBeCloseTo(20000, 6);
    expect(a.damping).toBe('over');
    expect(a.rlcText).toMatch(/Seri RLC/);
    const b = series(200);
    expect(b.alpha).toBeCloseTo(10000, 6);
    expect(b.damping).toBe('critical');
    const c = series(100);
    expect(c.alpha).toBeCloseTo(5000, 6);
    expect(c.damping).toBe('under');
    expect(c.omegaD).toBeCloseTo(8660.25, 1);
  });

  it('2. Paralel RLC: R = 2/3 Ω, L = 1 H, C = 0.5 F → s² + 3s + 2 = 0, kökler −1 ve −2, aşırı sönümlü', () => {
    const r = so(`I1 0 1 DC 1\nR1 1 0 ${2 / 3}\nL1 1 0 1\nC1 1 0 0.5`);
    expect(r.poly[1]).toBeCloseTo(3, 9);
    expect(r.poly[2]).toBeCloseTo(2, 9);
    expect(r.polyText).toBe('s² + 3·s + 2 = 0');
    expect(r.roots.map((x) => x.re)).toEqual([expect.closeTo(-1, 9), expect.closeTo(-2, 9)]);
    expect(r.damping).toBe('over');
    expect(r.rlcText).toMatch(/Paralel RLC/);
  });

  it('3. İki bobinli devre: karakteristik denklem s² + 7s + 6 = 0', () => {
    const r = so('Vs 1 0 DC 1\nR1 1 2 2\nL1 2 0 1\nL2 2 3 1\nR2 3 0 3');
    expect(r.order).toBe(2);
    expect(r.poly[1]).toBeCloseTo(7, 9);
    expect(r.poly[2]).toBeCloseTo(6, 9);
  });

  it('4. Zorlanmış yanıt: paralel R = 6 Ω, L = 7 H, C = 1/42 F, i_s = 8e^(−2t) A → i_f = −12e^(−2t) A', () => {
    const nl = parseNetlistText(`I1 0 1 DC 0\nR1 1 0 6\nL1 1 0 7\nC1 1 0 ${1 / 42}`);
    nl.elements[0].params = { mode: 'EXP', wk: 8, wb: 2, td: 0 };
    const out = analyze(nl, S({ tStop: 3, method: 'trap' }));
    const r = out.result as TranResult;
    const resp = r.secondOrder!.response!;
    const iL = r.secondOrder!.analysis.states.findIndex((s) => s.id === 'L1');
    expect(resp.index === iL || r.secondOrder!.analysis.states[resp.index].id === 'C1').toBe(true);
    // i_L için ayrı hesap
    const so2 = r.secondOrder!.analysis;
    expect(so2.roots.map((x) => x.re)).toEqual([expect.closeTo(-1, 9), expect.closeTo(-6, 9)]);
  });

  it('4b. Zorlanmış yanıt i_L: −12e^(−2t), tam yanıt simülasyonla eşleşir', async () => {
    const { completeResponse } = await import('../src/solver/methods/secondOrder');
    const nl = parseNetlistText(`I1 0 1 DC 0\nR1 1 0 6\nL1 1 0 7\nC1 1 0 ${1 / 42}`);
    nl.elements[0].params = { mode: 'EXP', wk: 8, wb: 2, td: 0 };
    const out = analyze(nl, S({ tStop: 3, method: 'trap', h: 1e-3 }));
    const r = out.result as TranResult;
    const a = r.secondOrder!.analysis;
    const k = a.states.findIndex((s) => s.id === 'L1');
    const m = completeResponse(nl, a, r, k)!;
    expect(m.exps[0].X).toBeCloseTo(-12, 6);
    expect(m.exps[0].s).toBeCloseTo(-2, 9);
    expect(m.deviation!).toBeLessThan(0.5);
    expect(responseEval(m, 1)).toBeCloseTo(r.comps.L1.I[1000], 3);
  });

  it('5. Çakışan giriş: aynı devre, i_s = 3e^(−6t) A → i_f = −3.6·t·e^(−6t) A', async () => {
    const { completeResponse } = await import('../src/solver/methods/secondOrder');
    const nl = parseNetlistText(`I1 0 1 DC 0\nR1 1 0 6\nL1 1 0 7\nC1 1 0 ${1 / 42}`);
    nl.elements[0].params = { mode: 'EXP', wk: 3, wb: 6, td: 0 };
    const out = analyze(nl, S({ tStop: 3, method: 'trap', h: 1e-3 }));
    const r = out.result as TranResult;
    const a = r.secondOrder!.analysis;
    const m = completeResponse(nl, a, r, a.states.findIndex((s) => s.id === 'L1'))!;
    expect(m.exps[0].t).toBe(true);
    expect(m.exps[0].X).toBeCloseTo(-3.6, 6);
    expect(m.note).toMatch(/çakışıyor/);
    expect(m.deviation!).toBeLessThan(0.5);
  });

  it('6. Üçüncü derece: C1, L, C2 ve R (C1 ile C2 ayrı düğümlerde) → derece 3, polinom gösterilir, α/ω₀ yok', () => {
    const r = so('V1 1 0 DC 1\nR1 1 2 1\nC1 2 0 1\nL1 2 3 1\nC2 3 0 1');
    expect(r.order).toBe(3);
    expect(r.poly).toHaveLength(4);
    expect(r.alpha).toBeUndefined();
    expect(r.damping).toBe('higher');
    expect(r.roots).toHaveLength(3);
  });

  it('7. C–V döngüsü: V1 = 5 V doğrudan C1 uçlarında; R = 1 kΩ ve L = 10 mH seri → C1 durum değişkeni değil, derece 1, τ = 10 µs', () => {
    const r = so('V1 1 0 DC 5\nC1 1 0 1u\nR1 1 2 1k\nL1 2 0 10m');
    expect(r.order).toBe(1);
    expect(r.states.map((s) => s.id)).toEqual(['L1']);
    expect(r.dependent[0].reason).toMatch(/C1'in gerilimi V1 tarafından belirleniyor/);
    expect(-1 / r.roots[0].re).toBeCloseTo(10e-6, 12);
    expect(analyze(parseNetlistText('V1 1 0 DC 5\nC1 1 0 1u\nR1 1 2 1k\nL1 2 0 10m'), S({ tStop: 1e-4 })).ok).toBe(true);
  });

  it('paralel kapasitörler tek sayılır; seri RLC basamak yanıtı formülü simülasyonla eşleşir', () => {
    const p = so('V1 1 0 DC 1\nR1 1 2 1\nC1 2 0 1\nC2 2 0 2\nL1 2 0 1');
    expect(p.order).toBe(2);
    expect(p.states[0].value).toBeCloseTo(3, 12);
    const out = analyze(parseNetlistText('V1 1 0 DC 10\nR1 1 2 100\nL1 2 3 10m\nC1 3 0 1u'), S({ tStop: 2e-3, method: 'trap', h: 1e-6 }));
    const r = out.result as TranResult;
    expect(r.secondOrder!.response!.formula).toMatch(/cos/);
    expect(r.secondOrder!.response!.deviation!).toBeLessThan(0.5);
  });

  it('sonuç Web Worker’dan aktarılabilir (structuredClone)', () => {
    const out = analyze(parseNetlistText('V1 1 0 DC 10\nR1 1 2 100\nL1 2 3 10m\nC1 3 0 1u'), S({ tStop: 1e-3 }));
    expect(() => structuredClone(out)).not.toThrow();
  });
});
