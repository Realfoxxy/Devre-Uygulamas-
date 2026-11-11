import { describe, expect, it } from 'vitest';
import { DEFAULT_ANALYSIS, AnalysisSettings } from '../src/core/circuit';
import { abs, argDeg } from '../src/core/complex';
import type { ACResult, DCResult, TranResult } from '../src/core/results';
import { analyze } from '../src/solver/analyze';
import { parseNetlistText } from '../src/solver/textNetlist';

const S = (o: Partial<AnalysisSettings>): AnalysisSettings => ({ ...DEFAULT_ANALYSIS, ...o });
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

function run(text: string, s: Partial<AnalysisSettings>) {
  const out = analyze(parseNetlistText(text), S(s));
  if (!out.ok) throw new Error(out.issues.map((i) => i.message).join('; '));
  return out.result!;
}

describe('DC analiz', () => {
  it('12 V, R1 = 1 kΩ, R2 = 2 kΩ seri → R2 üzerinde 8 V, 4 mA', () => {
    const r = run('V1 1 0 DC 12\nR1 1 2 1k\nR2 2 0 2k', { type: 'dc' }) as DCResult;
    expect(rel(r.comps.R2.V, 8)).toBeLessThan(1e-4);
    expect(rel(r.comps.R2.I, 4e-3)).toBeLessThan(1e-4);
    // kaynak güç veriyor: pasif işaret kuralıyla negatif
    expect(r.comps.V1.P).toBeLessThan(0);
    expect(rel(r.comps.V1.P, -0.048)).toBeLessThan(1e-4);
  });

  it('1 mA akım kaynağı, 1 kΩ ∥ 1 kΩ → düğüm gerilimi 0.5 V', () => {
    const r = run('I1 0 1 DC 1m\nR1 1 0 1k\nR2 1 0 1k', { type: 'dc' }) as DCResult;
    expect(rel(r.nodeV[1], 0.5)).toBeLessThan(1e-4);
  });

  it("RL, L DC'de → bobin gerilimi 0 V, akım V/R", () => {
    const r = run('V1 1 0 DC 10\nR1 1 2 100\nL1 2 0 10m', { type: 'dc' }) as DCResult;
    expect(Math.abs(r.comps.L1.V)).toBeLessThan(1e-12);
    expect(rel(r.comps.L1.I, 0.1)).toBeLessThan(1e-4);
  });

  it('kapasitör DC’de açık devre', () => {
    const r = run('V1 1 0 DC 5\nR1 1 2 1k\nC1 2 0 1u', { type: 'dc' }) as DCResult;
    expect(rel(r.comps.C1.V, 5)).toBeLessThan(1e-4);
    expect(r.comps.C1.I).toBe(0);
  });

  it('ampermetre ve voltmetre', () => {
    const r = run('V1 1 0 DC 9\nAM1 1 2\nR1 2 3 1k\nR2 3 0 2k\nVM1 3 0', { type: 'dc' }) as DCResult;
    expect(rel(r.comps.AM1.I, 3e-3)).toBeLessThan(1e-4);
    expect(rel(r.comps.VM1.V, 6)).toBeLessThan(1e-4);
    expect(r.comps.VM1.I).toBe(0);
  });
});

describe('AC analiz', () => {
  it('RC alçak geçiren, f = 1/(2πRC) → çıkış 0.707 kat, faz −45°', () => {
    const R = 1000;
    const C = 1e-6;
    const f = 1 / (2 * Math.PI * R * C);
    const r = run(`V1 1 0 AC 1 ${f} 0\nR1 1 2 1k\nC1 2 0 1u`, { type: 'ac' }) as ACResult;
    expect(rel(abs(r.comps.C1.V), Math.SQRT1_2)).toBeLessThan(1e-4);
    expect(Math.abs(argDeg(r.comps.C1.V) + 45)).toBeLessThan(1e-3);
  });

  it('RL, f = R/(2πL) → direnç gerilimi 0.707 kat, faz −45°', () => {
    const R = 100;
    const L = 10e-3;
    const f = R / (2 * Math.PI * L);
    const r = run(`V1 1 0 AC 1 ${f} 0\nL1 1 2 10m\nR1 2 0 100`, { type: 'ac' }) as ACResult;
    expect(rel(abs(r.comps.R1.V), Math.SQRT1_2)).toBeLessThan(1e-4);
    expect(Math.abs(argDeg(r.comps.R1.V) + 45)).toBeLessThan(1e-3);
  });

  it('frekans taraması logaritmik noktalar üretir', () => {
    const r = run('V1 1 0 AC 1 1k 0\nR1 1 2 1k\nC1 2 0 1u', {
      type: 'ac',
      sweep: true,
      fStart: 10,
      fStop: 10000,
      pointsPerDecade: 10,
    }) as ACResult;
    expect(r.sweep!.f.length).toBe(31);
    expect(r.sweep!.refId).toBe('V1');
    // alçak frekansta kazanç ≈ 1
    expect(abs(r.sweep!.comps.C1.V[0])).toBeGreaterThan(0.99);
  });
});

describe('Geçici rejim', () => {
  const at = (r: TranResult, time: number) => {
    let k = 0;
    for (let i = 0; i < r.t.length; i++) if (Math.abs(r.t[i] - time) < Math.abs(r.t[k] - time)) k = i;
    return k;
  };

  it('RC şarj, v0 = 0 → t = τ anında kapasitör gerilimi %63.2 (geri Euler, %1 tolerans)', () => {
    const r = run('V1 1 0 DC 10\nR1 1 2 1k\nC1 2 0 100u', { type: 'transient' }) as TranResult;
    const tau = 0.1;
    expect(rel(r.tau.C1, tau)).toBeLessThan(1e-6);
    const k = at(r, tau);
    expect(Math.abs(r.t[k] - tau)).toBeLessThan(1e-9);
    expect(rel(r.comps.C1.V[k], 6.321)).toBeLessThan(0.01);
    expect(r.comps.C1.V[0]).toBe(0);
  });

  it('RL, i0 = 0 → t = τ anında akım son değerin %63.2’si', () => {
    const r = run('V1 1 0 DC 10\nR1 1 2 100\nL1 2 0 100m', { type: 'transient' }) as TranResult;
    const tau = 1e-3;
    expect(rel(r.tau.L1, tau)).toBeLessThan(1e-6);
    const k = at(r, tau);
    expect(rel(r.comps.L1.I[k], 0.1 * 0.6321)).toBeLessThan(0.01);
  });

  it('trapez yöntemi daha hassas', () => {
    const r = run('V1 1 0 DC 10\nR1 1 2 1k\nC1 2 0 100u', { type: 'transient', method: 'trap' }) as TranResult;
    const k = at(r, 0.1);
    expect(rel(r.comps.C1.V[k], 10 * (1 - Math.exp(-1)))).toBeLessThan(1e-3);
  });

  it('kapasitör deşarjı (başlangıç gerilimi)', () => {
    const r = run('R1 1 0 1k\nC1 1 0 1m IC=5', { type: 'transient' }) as TranResult;
    const k = at(r, 1);
    expect(r.comps.C1.V[0]).toBe(5);
    expect(rel(r.comps.C1.V[k], 5 * Math.exp(-1))).toBeLessThan(0.015);
  });
});

describe('Doğrulama', () => {
  it('paralel iki farklı gerilim kaynağı → “Çözülemeyen devre”', () => {
    const out = analyze(parseNetlistText('V1 1 0 DC 5\nV2 1 0 DC 10\nR1 1 0 1k'), S({ type: 'dc' }));
    expect(out.ok).toBe(false);
    expect(out.issues[0].message).toMatch(/Çözülemeyen devre/);
    expect(out.issues[0].compIds).toEqual(expect.arrayContaining(['V1', 'V2']));
  });

  it('seri iki akım kaynağı → “Çözülemeyen devre”', () => {
    const out = analyze(parseNetlistText('I1 0 1 DC 1m\nI2 1 2 DC 2m\nR1 2 0 1k'), S({ type: 'dc' }));
    expect(out.ok).toBe(false);
    expect(out.issues[0].message).toMatch(/Çözülemeyen devre/);
  });

  it('DC’de kapasitörle ayrılmış düğüm', () => {
    const out = analyze(parseNetlistText('V1 1 0 DC 5\nC1 1 2 1u\nC2 2 0 1u'), S({ type: 'dc' }));
    expect(out.ok).toBe(false);
  });
});
