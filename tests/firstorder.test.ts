// Aşama 6: anahtarlar ve birinci derece devreler — beklenen değerler elle hesaplandı.
import { describe, expect, it } from 'vitest';
import { AnalysisSettings, DEFAULT_ANALYSIS } from '../src/core/circuit';
import type { TranResult } from '../src/core/results';
import { analyze } from '../src/solver/analyze';
import { parseNetlistText } from '../src/solver/textNetlist';
import { foEval } from '../src/solver/methods/firstOrder';

const S = (o: Partial<AnalysisSettings> = {}): AnalysisSettings => ({ ...DEFAULT_ANALYSIS, type: 'transient', ...o });
function tran(text: string, o: Partial<AnalysisSettings> = {}) {
  const out = analyze(parseNetlistText(text), S(o));
  if (!out.ok) throw new Error(out.issues.map((i) => i.message).join('; '));
  return { r: out.result as TranResult, out };
}
const at = (r: TranResult, time: number) => {
  let k = 0;
  for (let i = 0; i < r.t.length; i++) if (Math.abs(r.t[i] - time) < Math.abs(r.t[k] - time)) k = i;
  return k;
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('Anahtarlar ve birinci derece devreler', () => {
  it('1. RC şarjı: 10 V, anahtar t = 0’da kapanır, 1 kΩ, 1 µF → τ = 1 ms, v(1 ms) = 6.32 V, v(5 ms) = 9.93 V', () => {
    const { r } = tran('V1 1 0 DC 10\nSW1 1 2 open 0\nR1 2 3 1k\nC1 3 0 1u', { tStop: 6e-3 });
    const fo = r.firstOrder!;
    expect(fo.applicable).toBe(true);
    expect(fo.intervals[0].tau).toBeCloseTo(1e-3, 6);
    expect(foEval(fo.intervals[0], 1e-3)).toBeCloseTo(10 * (1 - Math.exp(-1)), 3);
    expect(rel(r.comps.C1.V[at(r, 1e-3)], 6.32)).toBeLessThan(0.01);
    expect(rel(r.comps.C1.V[at(r, 5e-3)], 9.93)).toBeLessThan(0.01);
    expect(fo.intervals[0].formula).toMatch(/v_C1\(t\) = 10\.0 V \+ \(0 V − 10\.0 V\)·e\^\(−t\/1\.00 ms\)/);
  });

  it('2. 0⁻ / 0⁺: anahtar açılınca i_L(0⁻) = i_L(0⁺) = 10 mA; v_R2(0⁺) = 20 V (sıçrama); τ = 5 µs', () => {
    const { r } = tran('V1 1 0 DC 10\nSW1 1 2 closed 0\nR1 2 3 1k\nL1 3 0 10m\nR2 3 0 2k', { tStop: 30e-6 });
    expect(r.initial!.before.L1.I).toBeCloseTo(0.01, 6);
    expect(r.initial!.after.L1.I).toBeCloseTo(0.01, 6);
    expect(Math.abs(r.initial!.before.R2.V)).toBeLessThan(1e-6);
    expect(Math.abs(r.initial!.after.R2.V)).toBeCloseTo(20, 3);
    expect(r.firstOrder!.intervals[0].tau).toBeCloseTo(5e-6, 9);
  });

  it('3. Ardışık anahtarlama: t = 1 ms’de C kaynaktan ayrılıp 1 kΩ üzerinden boşalır → v_C(2 ms) = 6.32·e⁻¹ = 2.33 V', () => {
    // ortak uç: R1 tarafı; A: kaynak, B: toprak (boşalma). t < 0: B; t = 0 → A; t = 1 ms → B
    const { r } = tran('V1 1 0 DC 10\nSW1 2 1 0 B 0,1m\nR1 2 3 1k\nC1 3 0 1u', { tStop: 3e-3, method: 'trap' });
    expect(rel(r.comps.C1.V[at(r, 2e-3)], 6.321 * Math.exp(-1))).toBeLessThan(0.01);
    const fo = r.firstOrder!;
    expect(fo.intervals).toHaveLength(2);
    expect(fo.intervals[1].t0).toBeCloseTo(1e-3, 12);
    expect(fo.intervals[1].xinf).toBeCloseTo(0, 6);
    expect(foEval(fo.intervals[1], 2e-3)).toBeCloseTo(10 * (1 - Math.exp(-1)) * Math.exp(-1), 3);
  });

  it('4. Bağımlı kaynaklı τ: Aşama 3 Thevenin devresinde a–toprak C = 3 µF → R_th = 1.333 Ω, τ = 4 µs', () => {
    const { r } = tran('Vs 1 0 DC 10\nR1 1 2 2\nVM1 2 0\nG1 2 0 0.25 VM1\nC1 2 0 3u', { tStop: 20e-6 });
    expect(r.firstOrder!.intervals[0].Rth).toBeCloseTo(4 / 3, 9);
    expect(r.firstOrder!.intervals[0].tau).toBeCloseTo(4e-6, 12);
  });

  it('5. Kararsız devre: R_th = −2 Ω → kararsızlık uyarısı', () => {
    const out = analyze(parseNetlistText('C1 1 0 1u IC=1\nR1 1 0 2\nVM1 1 0\nG1 0 1 1 VM1'), S({ tStop: 1e-5 }));
    expect(out.ok).toBe(true);
    const r = out.result as TranResult;
    expect(r.firstOrder!.unstable).toBe(true);
    expect(out.issues.some((i) => /kararsız/.test(i.message))).toBe(true);
  });

  it('6. İntegratör: 1 V basamak, R = 10 kΩ, C = 1 µF → v_çıkış(10 ms) = −1 V', () => {
    const nl = parseNetlistText('V1 1 0 DC 0\nR1 1 2 10k\nC1 2 3 1u\nOA1 0 2 3');
    nl.elements[0].params = { mode: 'STEP', w0: 0, w1: 1, td: 0 };
    const out = analyze(nl, S({ tStop: 20e-3 }));
    const r = out.result as TranResult;
    expect(r.comps.OA1.V[at(r, 10e-3)]).toBeCloseTo(-1, 3);
    expect(out.info.join(' ')).toMatch(/integral alıcı/);
  });

  it('7. Elle başlangıç koşulu: C = 1 µF manual, v(0⁻) = 5 V; anahtar t = 0’da 1 kΩ üzerinden boşaltır → v_C(1 ms) = 1.84 V', () => {
    const { r } = tran('C1 1 0 1u IC=5 MAN\nSW1 1 2 open 0\nR1 2 0 1k', { tStop: 5e-3 });
    expect(rel(r.comps.C1.V[at(r, 1e-3)], 5 * Math.exp(-1))).toBeLessThan(0.01);
  });

  it('8. Boşta düğüm: t < 0’da yalnızca açık anahtar ve C’ye bağlı düğüm → uyarı, v_C(0⁻) = 0, çökme yok', () => {
    const { r, out } = tran('V1 1 0 DC 10\nSW1 1 2 open 0\nC1 2 3 1u\nR1 3 0 1k', { tStop: 5e-3 });
    expect(out.info.some((i) => /boşta/.test(i))).toBe(true);
    expect(r.comps.C1.V[0]).toBeCloseTo(0, 6);
  });

  it('9. Türev alıcıya basamak: kenar uyarısı görünür, simülasyon sonlu değerlerle biter', () => {
    const nl = parseNetlistText('V1 1 0 DC 0\nC1 1 2 1u\nR1 2 3 10k\nOA1 0 2 3');
    nl.elements[0].params = { mode: 'STEP', w0: 0, w1: 1, td: 1e-3 };
    const out = analyze(nl, S({ tStop: 5e-3 }));
    expect(out.ok).toBe(true);
    expect(out.issues.some((i) => /dürtüdür/.test(i.message))).toBe(true);
    const v = (out.result as TranResult).comps.OA1.V;
    expect(Array.from(v).every((x) => Number.isFinite(x))).toBe(true);
  });

  it('sinüs girişli birinci derece: doğal + zorlanmış formül simülasyonla eşleşir', () => {
    const nl = parseNetlistText('V1 1 0 DC 0\nR1 1 2 1k\nC1 2 0 1u');
    nl.elements[0].params = { mode: 'SINE_U', amp: 5, freq: 200, phase: 0, td: 0 };
    const out = analyze(nl, S({ tStop: 10e-3, method: 'trap', h: 5e-6 }));
    const fo = (out.result as TranResult).firstOrder!;
    expect(fo.intervals[0].formula).toMatch(/sin/);
    expect(fo.intervals[0].deviation!).toBeLessThan(0.5);
  });
});

describe('Web Worker aktarımı', () => {
  it('geçici rejim sonucu structuredClone ile kopyalanabilir (fonksiyon içermez)', () => {
    const out = analyze(parseNetlistText('V1 1 0 DC 10\nSW1 1 2 open 0\nR1 2 3 1k\nC1 3 0 1u'), S({ tStop: 3e-3 }));
    expect(() => structuredClone(out)).not.toThrow();
  });
});
