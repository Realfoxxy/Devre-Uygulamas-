// Aşama 4: op-amp ve çok uçlu elemanlar — beklenen değerler elle hesaplandı.
import { describe, expect, it } from 'vitest';
import { AnalysisSettings, DEFAULT_ANALYSIS } from '../src/core/circuit';
import type { DCResult } from '../src/core/results';
import { analyze } from '../src/solver/analyze';
import { parseNetlistText } from '../src/solver/textNetlist';

const S = (o: Partial<AnalysisSettings> = {}): AnalysisSettings => ({ ...DEFAULT_ANALYSIS, ...o });
const run = (t: string) => analyze(parseNetlistText(t), S());
const dc = (t: string) => {
  const o = run(t);
  if (!o.ok) throw new Error(o.issues.map((i) => i.message).join('; '));
  return { r: o.result as DCResult, o };
};
// OA: + − çıkış
const INV = (vin: number, model = 'ideal') => `V1 1 0 DC ${vin}\nR1 1 2 1k\nRf 2 3 10k\nOA1 0 2 3 ${model}`;

describe('Op-amp ve çok uçlu elemanlar', () => {
  it('1. Eviren (ideal): V_giriş = 0.5 V, 1 kΩ, 10 kΩ → −5 V; sanal kısa devre', () => {
    const { r } = dc(INV(0.5));
    expect(r.comps.OA1.V).toBeCloseTo(-5, 9);
    expect(r.comps.OA1.pinV![1]).toBeCloseTo(0, 9); // v− = v+ = 0
  });

  it('2. Eviren (sonlu kazanç): −4.9994 V, ideale göre fark %0.011', () => {
    const { r, o } = dc(INV(0.5, 'finite'));
    expect(r.comps.OA1.V).toBeCloseTo(-4.9994, 3);
    const diff = (Math.abs(r.comps.OA1.V + 5) / 5) * 100;
    expect(diff).toBeGreaterThan(0.009);
    expect(diff).toBeLessThan(0.013);
    expect(o.info.join(' ')).toMatch(/fark %0.011/);
  });

  it('3. Evirmeyen: 1 V, R_g = 1 kΩ, R_f = 4 kΩ → 5 V; toplayıcı: 1 V ve 2 V, tüm dirençler 10 kΩ → −3 V', () => {
    expect(dc('V1 1 0 DC 1\nRg 2 0 1k\nRf 2 3 4k\nOA1 1 2 3').r.comps.OA1.V).toBeCloseTo(5, 9);
    expect(dc('V1 1 0 DC 1\nV2 4 0 DC 2\nR1 1 2 10k\nR2 4 2 10k\nRf 2 3 10k\nOA1 0 2 3').r.comps.OA1.V).toBeCloseTo(-3, 9);
  });

  it('4. Doyum: eviren yükselteçte V_giriş = 2 V → −20 V ve uyarı', () => {
    const { r, o } = dc(INV(2));
    expect(r.comps.OA1.V).toBeCloseTo(-20, 9);
    expect(o.issues.some((i) => i.level === 'warning' && /doyuma girerdi/.test(i.message))).toBe(true);
  });

  it('5. Potansiyometre: 10 V uçlarında, R_p = 10 kΩ, a = 0.3 → orta uç 3 V (alt uçtan)', () => {
    // POT: üst uç, alt uç, orta uç
    const { r } = dc('V1 1 0 DC 10\nPOT1 1 0 2 10k 0.3\nVM1 2 0');
    expect(r.comps.VM1.V).toBeCloseTo(3, 9);
  });

  it('6. Sıcaklık sensörü: 25 °C → 298.15 µA; 10 kΩ’a akıtılınca 2.98 V', () => {
    const { r } = dc('TS1 0 1 1u 25\nR1 1 0 10k');
    expect(r.comps.TS1.I).toBeCloseTo(298.15e-6, 12);
    expect(r.comps.R1.V).toBeCloseTo(2.9815, 9);
  });

  it('7. Geri beslemesiz op-amp: çökmez, Türkçe hata', () => {
    const o = run('V1 1 0 DC 1\nOA1 1 0 2\nRL 2 0 1k');
    expect(o.ok).toBe(false);
    expect(o.issues[0].message).toMatch(/negatif geri beslemesi yok/);
  });

  it('8. Potansiyometre uçları: a = 0 → 0 V, a = 1 → 10 V; çökme yok', () => {
    expect(dc('V1 1 0 DC 10\nPOT1 1 0 2 10k 0\nVM1 2 0').r.comps.VM1.V).toBeCloseTo(0, 5);
    expect(dc('V1 1 0 DC 10\nPOT1 1 0 2 10k 1\nVM1 2 0').r.comps.VM1.V).toBeCloseTo(10, 5);
  });

  it('9. Voltmetre yüklemesi: ideal 5 V, 10 MΩ’luk gerçek voltmetre 3.333 V, yükleme hatası %33', () => {
    const { r } = dc('V1 1 0 DC 10\nR1 1 2 10M\nR2 2 0 10M\nVM1 2 0 R=10M');
    expect(r.comps.VM1.V).toBeCloseTo(10 / 3, 9);
    expect(r.idealMeters!.VM1).toBeCloseTo(5, 9);
    const err = (Math.abs(r.comps.VM1.V - r.idealMeters!.VM1) / 5) * 100;
    expect(err).toBeCloseTo(33.33, 1);
  });

  it('iki yollu anahtar: konum A / B', () => {
    const t = (w: string) => dc(`V1 1 0 DC 10\nV2 2 0 DC 3\nSW1 3 1 2 ${w}\nR1 3 0 1k`).r.comps.R1.V;
    expect(t('A')).toBeCloseTo(10, 4);
    expect(t('B')).toBeCloseTo(3, 4);
  });

  it('ofsetli op-amp: evirmeyen ×5 kazançta çıkış 5·V_os kadar kayar', () => {
    const { r } = dc('V1 1 0 DC 0\nRg 2 0 1k\nRf 2 3 4k\nOA1 1 2 3 offset');
    // V_os = 5 mV → 25 mV, I_b·R_f = 500 nA · 4 kΩ = 2 mV
    expect(r.comps.OA1.V).toBeCloseTo(0.025 + 0.002, 6);
  });

  it('op-amp ile AC ve geçici rejim çalışır', () => {
    expect(analyze(parseNetlistText('V1 1 0 AC 0.5 1k 0\nR1 1 2 1k\nRf 2 3 10k\nOA1 0 2 3'), S({ type: 'ac' })).ok).toBe(true);
    expect(analyze(parseNetlistText('V1 1 0 DC 0.5\nR1 1 2 1k\nRf 2 3 10k\nC1 2 3 1u\nOA1 0 2 3'), S({ type: 'transient' })).ok).toBe(true);
  });
});

import { nodeEquations } from '../src/solver/methods/nodal';
describe('Op-amp ile düğüm denklemleri', () => {
  it('eviren yükselteç: çıkışta KAY yerine v₊ = v₋, sonuç MNA ile aynı', () => {
    const nl = parseNetlistText('V1 1 0 DC 0.5\nR1 1 2 1k\nRf 2 3 10k\nOA1 0 2 3');
    const r = nodeEquations(nl);
    expect(r.ok).toBe(true);
    expect(r.equations.some((e) => e.title.includes('sanal kısa devre'))).toBe(true);
    expect(r.values.v3).toBeCloseTo(-5, 9);
  });
  it('potansiyometre iki dirence açılır', () => {
    const r = nodeEquations(parseNetlistText('V1 1 0 DC 10\nPOT1 1 0 2 10k 0.3\nR1 2 0 1G'));
    expect(r.values.v2).toBeCloseTo(3, 4);
  });
});
