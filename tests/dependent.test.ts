// Aşama 1: bağımlı kaynaklar — beklenen değerler elle hesaplandı.
import { describe, expect, it } from 'vitest';
import { AnalysisSettings, DEFAULT_ANALYSIS } from '../src/core/circuit';
import type { DCResult, TranResult } from '../src/core/results';
import { analyze } from '../src/solver/analyze';
import { parseNetlistText } from '../src/solver/textNetlist';
import { buildNetlist } from '../src/core/netlist';
import { deserialize, serialize } from '../src/storage/project';

const S = (o: Partial<AnalysisSettings> = {}): AnalysisSettings => ({ ...DEFAULT_ANALYSIS, ...o });
function dc(text: string) {
  const out = analyze(parseNetlistText(text), S());
  if (!out.ok) throw new Error(out.issues.map((i) => i.message).join('; '));
  return out.result as DCResult;
}

describe('Bağımlı kaynaklar', () => {
  it('1. VCVS: V1 = 2 V, E1 = 5·v(VM1) → 10 V, 1 kΩ üzerinde 10 mA', () => {
    const r = dc('V1 1 0 DC 2\nVM1 1 0\nE1 2 0 5 VM1\nR1 2 0 1k');
    expect(r.comps.E1.V).toBeCloseTo(10, 9);
    expect(r.comps.R1.I).toBeCloseTo(0.01, 12);
    // E1 güç veriyor: pasif işaret kuralıyla negatif
    expect(r.comps.E1.P).toBeCloseTo(-0.1, 9);
  });

  it('2. CCCS: AM1 = 10 mA, F1 = 2·i(AM1) → 500 Ω üzerinde 10 V', () => {
    const r = dc('V1 1 0 DC 10\nR1 1 2 1k\nAM1 2 0\nF1 0 3 2 AM1\nR2 3 0 500');
    expect(r.comps.AM1.I).toBeCloseTo(0.01, 12);
    expect(r.comps.R2.V).toBeCloseTo(10, 9);
    expect(r.comps.F1.I).toBeCloseTo(0.02, 12);
  });

  it('3. R akımıyla kontrol: AM1 yerine R1 seçilince aynı sonuç', () => {
    const r = dc('V1 1 0 DC 10\nR1 1 2 1k\nAM1 2 0\nF1 0 3 2 R1\nR2 3 0 500');
    expect(r.comps.R2.V).toBeCloseTo(10, 9);
  });

  it('CCVS ve VCCS', () => {
    const r = dc('V1 1 0 DC 10\nR1 1 0 1k\nH1 2 0 500 R1\nR2 2 0 1k\nG1 0 3 0.002 R1\nR3 3 0 100');
    expect(r.comps.H1.V).toBeCloseTo(5, 9); // 500 Ω · 10 mA
    expect(r.comps.R3.V).toBeCloseTo(2, 9); // 2 mS · 10 V · 100 Ω
  });

  it('4. Hatalar: kontrol bileşeni yok, kendini kontrol, VCVS bir gerilim kaynağına paralel', () => {
    const a = analyze(parseNetlistText('V1 1 0 DC 2\nE1 2 0 5 VM9\nR1 2 0 1k'), S());
    expect(a.ok).toBe(false);
    expect(a.issues[0].message).toMatch(/VM9 bileşeninin gerilimine bağlı ama VM9 devrede yok/);
    const b = analyze(parseNetlistText('V1 1 0 DC 2\nF1 0 2 2 F1\nR1 2 0 1k\nR2 1 0 1k'), S());
    expect(b.issues[0].message).toMatch(/kendisini kontrol edemez/);
    const c = analyze(parseNetlistText('V1 1 0 DC 2\nVM1 1 0\nE1 1 0 5 VM1\nR1 1 0 1k'), S());
    expect(c.ok).toBe(false);
    expect(c.issues[0].message).toMatch(/Çözülemeyen devre/);
    expect(c.issues[0].compIds).toEqual(expect.arrayContaining(['V1', 'E1']));
  });

  it('6. L akımıyla kontrol: DC’de aynı sonuç; geçici rejimde F1 = 2·i_L1 her adımda', () => {
    const r = dc('V1 1 0 DC 10\nR1 1 2 1k\nL1 2 0 10m\nF1 0 3 2 L1\nR2 3 0 500');
    expect(r.comps.R2.V).toBeCloseTo(10, 9);
    const out = analyze(parseNetlistText('V1 1 0 DC 10\nR1 1 2 1k\nL1 2 0 10m\nF1 0 3 2 L1\nR2 3 0 500'), S({ type: 'transient' }));
    expect(out.ok).toBe(true);
    const t = out.result as TranResult;
    for (let k = 0; k < t.t.length; k += 7) expect(t.comps.F1.I[k]).toBeCloseTo(2 * t.comps.L1.I[k], 12);
    // son değer DC ile aynı
    expect(t.comps.L1.I[t.t.length - 1]).toBeCloseTo(0.01, 3);
  });

  it('6b. C akımıyla kontrol (AC ve geçici rejimde gizli ölçüm dalı)', () => {
    const out = analyze(parseNetlistText('V1 1 0 DC 10\nR1 1 2 1k\nC1 2 0 1u\nF1 0 3 1 C1\nR2 3 0 1k'), S({ type: 'transient' }));
    const t = out.result as TranResult;
    for (let k = 1; k < t.t.length; k += 13) expect(t.comps.R2.V[k]).toBeCloseTo(1000 * t.comps.C1.I[k], 9);
  });

  it('7. Cebirsel döngü: 5 − i + i = 0 → sorumlu H1 için açıklayıcı mesaj, çökme yok', () => {
    // V1 + ucu 1; R1 1→2; AM1 2→3; H1 + ucu 0'da (akım H1'den çıkıp 0'a döner)... H1: 0 3 → v0 − v3 = i
    const out = analyze(parseNetlistText('V1 1 0 DC 5\nR1 1 2 1\nAM1 2 3\nH1 0 3 1 AM1'), S());
    expect(out.ok).toBe(false);
    expect(out.issues[0].message).toMatch(/H1'in kazancı bu değerde devreyi çözümsüz yapıyor/);
    expect(out.issues[0].compIds).toEqual(['H1']);
  });
});

describe('5. Dosya sürümü', () => {
  it('v1 açılır; v2 kaydedilip açılınca aynı sonuç', () => {
    const v1 = `{"version":1,"components":[
      {"id":"V1","type":"V","x":0,"y":4,"rot":90,"params":{"mode":"DC","value":2}},
      {"id":"GND1","type":"GND","x":0,"y":8,"rot":0,"params":{}}],"wires":[{"from":[0,6],"to":[0,8]}]}`;
    const d1 = deserialize(v1);
    expect(d1.version).toBe(2);
    const doc = {
      ...d1,
      components: [
        { id: 'V1', type: 'V' as const, x: 0, y: 4, rot: 90, params: { mode: 'DC' as const, value: 2 } },
        { id: 'VM1', type: 'VM' as const, x: 4, y: 4, rot: 90, params: {} },
        { id: 'E1', type: 'E' as const, x: 8, y: 4, rot: 90, params: { gain: 5, ctrl: { ref: 'VM1', kind: 'V' as const } } },
        { id: 'R1', type: 'R' as const, x: 12, y: 4, rot: 90, params: { value: 1000 } },
        { id: 'GND1', type: 'GND' as const, x: 0, y: 8, rot: 0, params: {} },
      ],
      wires: [
        { id: 'w1', from: [0, 2] as [number, number], to: [12, 2] as [number, number] },
        { id: 'w2', from: [0, 6] as [number, number], to: [12, 6] as [number, number] },
        { id: 'w3', from: [0, 6] as [number, number], to: [0, 8] as [number, number] },
      ],
    };
    // E1 çıkışı R1'e ayrı düğümde bağlansın: üst kabloyu böl
    doc.wires = [
      { id: 'w1', from: [0, 2], to: [4, 2] },
      { id: 'w2', from: [0, 6], to: [4, 6] },
      { id: 'w5', from: [4, 6], to: [8, 6] },
      { id: 'w6', from: [8, 6], to: [12, 6] },
      { id: 'w3', from: [0, 6], to: [0, 8] },
      { id: 'w4', from: [8, 2], to: [12, 2] },
    ];
    const back = deserialize(serialize(doc));
    expect(back.version).toBe(2);
    expect(back.components.find((c) => c.id === 'E1')!.params.ctrl).toEqual({ ref: 'VM1', kind: 'V' });
    const r1 = analyze(buildNetlist(doc.components, doc.wires), S()).result as DCResult;
    const r2 = analyze(buildNetlist(back.components, back.wires), S()).result as DCResult;
    expect(r1.comps.R1.V).toBeCloseTo(10, 9);
    expect(r2.comps.R1.V).toBeCloseTo(r1.comps.R1.V, 12);
  });
});
