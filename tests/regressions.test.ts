// Denetimde bulunan hatalar için regresyon testleri (elle hesaplanan değerler).
import { describe, expect, it } from 'vitest';
import { AnalysisSettings, DEFAULT_ANALYSIS } from '../src/core/circuit';
import { instPower } from '../src/core/energy';
import type { ACResult, DCResult, TranResult } from '../src/core/results';
import { analyze } from '../src/solver/analyze';
import { parseNetlistText } from '../src/solver/textNetlist';

const S = (o: Partial<AnalysisSettings> = {}): AnalysisSettings => ({ ...DEFAULT_ANALYSIS, ...o });

describe('Denetim regresyonları', () => {
  it('yüklü potansiyometre: güç iki parçanın toplamı, pin akımları KAY’ı sağlar', () => {
    // 10 V, 1 kΩ pot (a = 0.5), orta uçta 500 Ω yük → v_w = 10/3 V
    const nl = parseNetlistText('V1 1 0 DC 10\nPOT1 1 0 2 1k 0.5\nR1 2 0 500');
    const r = analyze(nl, S({ type: 'dc' })).result as DCResult;
    const pot = r.comps.POT1;
    const vw = 10 / 3;
    expect(pot.pinV![2]).toBeCloseTo(vw, 9);
    expect(pot.P).toBeCloseTo((10 - vw) ** 2 / 500 + vw ** 2 / 500, 9);
    expect(pot.pinI!.reduce((s, x) => s + x, 0)).toBeCloseTo(0, 12);
    expect(pot.pinI![2]).toBeCloseTo(-vw / 500, 9); // orta uçtan yüke akan akım
    const total = Object.values(r.comps).reduce((s, c) => s + c.P, 0);
    expect(total).toBeCloseTo(0, 12);
  });

  it('op-amp gücü DC, AC ve geçici rejimde aynı işaretli (güç veriyor)', () => {
    const txt = (src: string) => `V1 1 0 ${src}\nR1 1 2 1k\nR2 2 3 2k\nOA1 0 2 3 ideal\nRL 3 0 1k`;
    // v_o = −2 V, çıkış akımı −3 mA → op-amp 6 mW veriyor
    const dc = analyze(parseNetlistText(txt('DC 1')), S({ type: 'dc' })).result as DCResult;
    expect(dc.comps.OA1.P).toBeCloseTo(-6e-3, 9);
    const ac = analyze(parseNetlistText(txt('AC 1 1k 0')), S({ type: 'ac' })).result as ACResult;
    expect(ac.comps.OA1.P).toBeCloseTo(-3e-3, 9);
    const tr = analyze(parseNetlistText(txt('DC 1')), S({ type: 'transient', tStop: 1e-3 })).result as TranResult;
    expect(instPower(tr.comps.OA1, tr.t.length - 1)).toBeCloseTo(-6e-3, 9);
  });

  it('darbe kenarı bir adım erken uygulanmaz: RC, 2 ms’deki düşen kenardan sonra formülle eşleşir', () => {
    const nl = parseNetlistText('V1 1 0 DC 0\nR1 1 2 1k\nC1 2 0 1u');
    nl.elements[0].params = { mode: 'PULSE', w0: 0, w1: 5, td: 0, pw: 2e-3, per: 4e-3 };
    const r = analyze(nl, S({ type: 'transient', tStop: 4e-3, h: 20e-6 })).result as TranResult;
    const at = (t: number) => r.comps.C1.V[r.t.findIndex((x) => Math.abs(x - t) < 1e-12)];
    const x0 = 5 * (1 - Math.exp(-2));
    expect(at(2e-3)).toBeCloseTo(x0, 4);
    expect(at(2.5e-3)).toBeCloseTo(x0 * Math.exp(-0.5), 4);
    expect(at(4e-3)).toBeCloseTo(x0 * Math.exp(-2), 4);
  });

  it('varsayılan yöntem trapez: RC şarjında 5τ anındaki akım formülle %0.1 içinde', () => {
    const nl = parseNetlistText('V1 1 0 DC 10\nR1 1 2 1k\nC1 2 0 100u');
    const r = analyze(nl, S({ type: 'transient', tStop: 0.5 })).result as TranResult;
    expect(r.method).toBe('trap');
    const i = r.comps.R1.I[r.t.length - 1];
    const exact = 0.01 * Math.exp(-5);
    expect(Math.abs(i - exact) / exact).toBeLessThan(1e-3);
  });
});
