// Aşama 3: devre teoremleri — beklenen değerler elle hesaplandı.
import { describe, expect, it } from 'vitest';
import { abs } from '../src/core/complex';
import { maxPower, sourceTransform, superposition, thevenin, dcValues } from '../src/solver/methods/theorems';
import { parseNetlistText } from '../src/solver/textNetlist';

const DC = { kind: 'dc' as const };

describe('Devre teoremleri', () => {
  it('1. Kaynak dönüşümü: 12 V + 3 Ω seri, yük 6 Ω → 4 A ∥ 3 Ω; yük akımı her iki durumda 1.333 A', () => {
    const nl = parseNetlistText('V1 1 0 DC 12\nR1 1 2 3\nRL 2 0 6');
    const before = dcValues(nl)!;
    expect(before.RL.I).toBeCloseTo(4 / 3, 9);
    const t = sourceTransform(nl, 'V1');
    expect(t.ok).toBe(true);
    expect(t.kind).toBe('VtoI');
    expect(t.value).toBeCloseTo(4, 12);
    expect(t.R).toBe(3);
    const after = dcValues(t.netlist!)!;
    expect(after.RL.I).toBeCloseTo(4 / 3, 9);
    expect(after.RL.V).toBeCloseTo(before.RL.V, 9);
    // geri dönüşüm: 4 A ∥ 3 Ω → 12 V + 3 Ω
    expect(sourceTransform(t.netlist!, 'V1').ok).toBe(false); // R1 ve RL ikisi de paralel: seçim gerekir
    const back = sourceTransform(t.netlist!, 'V1', { resistor: 'R1' });
    expect(back.kind).toBe('ItoV');
    expect(back.value).toBeCloseTo(12, 12);
    expect(dcValues(back.netlist!)!.RL.I).toBeCloseTo(4 / 3, 9);
  });

  it('2. Bağımlı kaynaklı Thevenin: V_th = 6.667 V, I_N = 5 A, R_th = 1.333 Ω (sıfırlansaydı 2 Ω çıkardı)', () => {
    const nl = parseNetlistText('Vs 1 0 DC 10\nR1 1 2 2\nVM1 2 0\nG1 2 0 0.25 VM1');
    const th = thevenin(nl, 2, 0, DC);
    expect(th.Vth!.re).toBeCloseTo(20 / 3, 9);
    expect(th.IN!.re).toBeCloseTo(5, 9);
    expect(th.Zth!.re).toBeCloseTo(4 / 3, 9);
    expect(th.Zth!.re).not.toBeCloseTo(2, 3);
    expect(th.consistent).toBe(true);
  });

  it('3. Köprü: R_eş = 1700/71 Ω = 23.94 Ω', () => {
    // a=1, b=2, c=3, d=4
    const nl = parseNetlistText('R1 1 3 10\nR2 1 4 20\nR3 3 2 30\nR4 4 2 40\nR5 3 4 50\nRg 2 0 1e12');
    const th = thevenin(nl, 1, 2, DC);
    expect(th.Zth!.re).toBeCloseTo(1700 / 71, 6);
    expect(th.resistiveOnly).toBe(true);
  });

  it('4. Maksimum güç: V_th = 12 V, R_th = 4 Ω → P_max = 9 W, R_L = 4 Ω', () => {
    const nl = parseNetlistText('V1 1 0 DC 12\nR1 1 2 4\nRL 2 0 100');
    const th = thevenin(nl, 2, 0, DC, 'RL');
    expect(th.Vth!.re).toBeCloseTo(12, 9);
    expect(th.Zth!.re).toBeCloseTo(4, 9);
    const mp = maxPower(th);
    expect(mp.ok).toBe(true);
    expect(mp.Pmax).toBeCloseTo(9, 9);
    expect(mp.ZL!.re).toBeCloseTo(4, 9);
    const k = mp.sweep!.P.indexOf(Math.max(...mp.sweep!.P));
    expect(mp.sweep!.R[k]).toBeCloseTo(4, 6);
  });

  it('5. Süperpozisyon: katkıların toplamı tam çözüme 1e-9 hassasiyetle eşit; güç toplanmaz', () => {
    const nl = parseNetlistText('V1 1 0 DC 10\nR1 1 2 2\nR2 2 0 4\nI1 0 2 DC 2\nR3 2 0 4');
    const r = superposition(nl, 'R2', DC);
    if ('error' in r) throw new Error(r.error);
    expect(r.rows).toHaveLength(2);
    expect(Math.abs(r.sumV.re - r.full.V.re)).toBeLessThan(1e-9);
    expect(Math.abs(r.sumI.re - r.full.I.re)).toBeLessThan(1e-9);
    expect(Math.abs(r.sumP - r.full.P)).toBeGreaterThan(1e-3);
    expect(r.rows[0].zeroed).toEqual(['I1']);
  });

  it('6. R_th = 0: a–b doğrudan 10 V kaynağın uçlarında → V_th = 10 V, Norton yok, çökme yok', () => {
    const nl = parseNetlistText('V1 1 0 DC 10\nR1 1 0 5');
    const th = thevenin(nl, 1, 0, DC);
    expect(th.Vth!.re).toBeCloseTo(10, 9);
    expect(abs(th.Zth!)).toBeLessThan(1e-9);
    expect(th.IN).toBeNull();
    expect(th.notes.join(' ')).toMatch(/Norton yok/);
  });

  it('7. R_th → ∞: a–b’de yalnızca 2 A ideal akım kaynağı → I_N = 2 A, Thevenin yok', () => {
    const nl = parseNetlistText('I1 0 1 DC 2');
    const th = thevenin(nl, 1, 0, DC);
    expect(th.IN!.re).toBeCloseTo(2, 9);
    expect(th.Zth).toBeNull();
    expect(th.Vth).toBeNull();
    expect(th.notes.join(' ')).toMatch(/Thevenin yok/);
  });

  it('8. R_th < 0: maksimum güç taraması kapalı, NaN üretilmez', () => {
    // a düğümünde C ve 2 Ω toprağa; VCCS (G = 1 S, kontrol v_a) akımı topraktan a'ya iter
    const nl = parseNetlistText('C1 1 0 1u\nR1 1 0 2\nVM1 1 0\nG1 0 1 1 VM1');
    const th = thevenin(nl, 1, 0, DC);
    expect(th.Zth!.re).toBeCloseTo(-2, 9);
    const mp = maxPower(th);
    expect(mp.ok).toBe(false);
    expect(mp.message).toMatch(/R_th ≤ 0/);
    expect(JSON.stringify(mp)).not.toMatch(/NaN/);
  });

  it('9. AC maksimum güç: V_th = 10 V (tepe), Z_th = 4 + j3 Ω → Z_L = 4 − j3 Ω, P_max = 3.125 W', () => {
    // f = 1/(2π) Hz → ω = 1; L = 3 H → jωL = j3
    const f = 1 / (2 * Math.PI);
    const nl = parseNetlistText(`V1 1 0 AC 10 ${f} 0\nR1 1 2 4\nL1 2 3 3\nRL 3 0 1`);
    const th = thevenin(nl, 3, 0, { kind: 'ac', freq: f }, 'RL');
    expect(th.Zth!.re).toBeCloseTo(4, 9);
    expect(th.Zth!.im).toBeCloseTo(3, 9);
    const mp = maxPower(th);
    expect(mp.ZL!.re).toBeCloseTo(4, 9);
    expect(mp.ZL!.im).toBeCloseTo(-3, 9);
    expect(mp.Pmax).toBeCloseTo(3.125, 9);
  });
});
