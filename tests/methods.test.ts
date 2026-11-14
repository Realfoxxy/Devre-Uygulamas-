// Aşama 2: analiz yöntemleri — beklenen değerler elle hesaplandı.
import { describe, expect, it } from 'vitest';
import { Component, DEFAULT_ANALYSIS, Pt, Wire } from '../src/core/circuit';
import { buildNetlist } from '../src/core/netlist';
import type { DCResult } from '../src/core/results';
import { analyze } from '../src/solver/analyze';
import { toSpice } from '../src/solver/methods/export';
import { kclAt, kvlLoop } from '../src/solver/methods/kirchhoff';
import { evalLin, meshEquations } from '../src/solver/methods/mesh';
import { nodeEquations } from '../src/solver/methods/nodal';
import { seriesParallel } from '../src/solver/methods/seriesParallel';
import { parseNetlistText } from '../src/solver/textNetlist';

const C = (id: string, type: Component['type'], x: number, y: number, rot: number, params: Component['params'] = {}): Component => ({ id, type, x, y, rot, params });
let wn = 0;
const W = (pts: Pt[]): Wire[] => pts.slice(1).map((p, i) => ({ id: `w${++wn}`, from: pts[i], to: p }));

/** Test 1 devresi: V1 = 10 V solda, R1 = 2 Ω üstte, R2 = 4 Ω ortak dalda, R3 = 4 Ω sağda. */
function twoMesh(middle: Component, right: Component = C('R3', 'R', 16, 4, 90, { value: 4 })) {
  const comps = [
    C('V1', 'V', 0, 4, 90, { mode: 'DC', value: 10 }),
    C('R1', 'R', 4, 0, 0, { value: 2 }),
    middle,
    right,
    C('GND1', 'GND', 0, 8, 0),
  ];
  const wires = [
    ...W([[0, 2], [0, 0], [2, 0]]),
    ...W([[6, 0], [8, 0], [8, 2]]),
    ...W([[8, 0], [16, 0], [16, 2]]),
    ...W([[0, 6], [0, 8], [8, 8], [8, 6]]),
    ...W([[8, 8], [16, 8], [16, 6]]),
  ];
  return { comps, wires, nl: buildNetlist(comps, wires) };
}

describe('Düğüm ve çevre denklemleri', () => {
  it('1. Düğüm ve çevre: v2 = 5 V; i1 = 2.5 A, i2 = 1.25 A; 6·i1 − 4·i2 = 10, −4·i1 + 8·i2 = 0', () => {
    const { comps, wires, nl } = twoMesh(C('R2', 'R', 8, 4, 90, { value: 4 }));
    expect(nl.issues).toEqual([]);
    const node = nodeEquations(nl);
    expect(node.ok).toBe(true);
    const n2 = nl.pinNodes.R2[0];
    expect(node.values[`v${n2}`]).toBeCloseTo(5, 12);
    const mesh = meshEquations(comps, wires, nl);
    expect(mesh.ok).toBe(true);
    expect(mesh.unknowns).toEqual(['i1', 'i2']);
    expect(mesh.values.i1).toBeCloseTo(2.5, 12);
    expect(mesh.values.i2).toBeCloseTo(1.25, 12);
    expect(mesh.equations.map((e) => e.simplified)).toEqual(['6·i1 − 4·i2 = 10', '−4·i1 + 8·i2 = 0']);
    expect(mesh.equations[0].text).toBe('2·i1 + 4·(i1 − i2) = 10');
  });

  it('2. Süperdüğüm: v2 = 6 V, v3 = 2 V; süperdüğüm {2, 3}, kısıt v2 − v3 = 4', () => {
    const r = nodeEquations(parseNetlistText('V1 1 0 DC 10\nR1 1 2 2\nV2 2 3 DC 4\nR2 2 0 4\nR3 3 0 4'));
    expect(r.values.v2).toBeCloseTo(6, 12);
    expect(r.values.v3).toBeCloseTo(2, 12);
    expect(r.supernodes).toEqual([[2, 3]]);
    expect(r.equations.some((e) => e.text === 'v2 − v3 = 4')).toBe(true);
    expect(r.given).toEqual(['v1 = 10 V']);
    expect(r.equations[0].text).toBe('(v2 − 10)/2 + v2/4 + v3/4 = 0');
  });

  it('3. Süperçevre: iki çevre arasında akım kaynağı; çevre akımları MNA dal akımlarıyla 1e-9 eşleşir', () => {
    // ortak dalda yukarı doğru 2 A'lik akım kaynağı
    const { comps, wires, nl } = twoMesh(C('I1', 'I', 8, 4, 270, { mode: 'DC', value: 2 }));
    const mesh = meshEquations(comps, wires, nl);
    expect(mesh.ok).toBe(true);
    expect(mesh.supermeshes).toEqual([['i1', 'i2']]);
    const dc = analyze(nl, DEFAULT_ANALYSIS).result as DCResult;
    for (const id of ['R1', 'R3', 'V1', 'I1']) expect(evalLin(mesh.branchCurrents[id], mesh.values)).toBeCloseTo(dc.comps[id].I, 9);
  });

  it('dış dalda akım kaynağı: o çevrenin akımı doğrudan bilinir', () => {
    const { comps, wires, nl } = twoMesh(C('R2', 'R', 8, 4, 90, { value: 4 }), C('I1', 'I', 16, 4, 90, { mode: 'DC', value: 3 }));
    const mesh = meshEquations(comps, wires, nl);
    expect(mesh.ok).toBe(true);
    expect(mesh.given).toEqual(['i2 = 3 A']); // kaynak saat yönünde (aşağı) akıyor
    const dc = analyze(nl, DEFAULT_ANALYSIS).result as DCResult;
    expect(evalLin(mesh.branchCurrents.R2, mesh.values)).toBeCloseTo(dc.comps.R2.I, 9);
  });

  it('4. Düzlemsel olmayan çizim: çevre sekmesi açıklayıcı mesaj verir, düğüm sekmesi çalışır', () => {
    const { comps, wires } = twoMesh(C('R2', 'R', 8, 4, 90, { value: 4 }));
    comps.push(C('R4', 'R', 12, 12, 90, { value: 10 }));
    wires.push(...W([[0, 0], [0, -2], [12, -2], [12, 10]]), ...W([[12, 14], [0, 14], [0, 8]]));
    const nl = buildNetlist(comps, wires);
    expect(nl.issues).toEqual([]);
    const mesh = meshEquations(comps, wires, nl);
    expect(mesh.ok).toBe(false);
    expect(mesh.message).toMatch(/düzlemsel çizilmemiş/);
    expect(nodeEquations(nl).ok).toBe(true);
  });

  it('6. Zincirleme süperdüğüm: {2, 3, 4}, iki kısıt; v2 = 5.8, v3 = 1.8, v4 = 0.8 V', () => {
    const r = nodeEquations(parseNetlistText('V1 1 0 DC 10\nR1 1 2 2\nVs1 2 3 DC 4\nVs2 3 4 DC 1\nR2 2 0 4\nR3 3 0 4\nR4 4 0 4'));
    expect(r.supernodes).toEqual([[2, 3, 4]]);
    expect(r.equations.filter((e) => e.title.includes('kısıt'))).toHaveLength(2);
    expect(r.values.v2).toBeCloseTo(5.8, 12);
    expect(r.values.v3).toBeCloseTo(1.8, 12);
    expect(r.values.v4).toBeCloseTo(0.8, 12);
  });

  it('bağımlı kaynaklı düğüm analizi MNA ile aynı', () => {
    const text = 'V1 1 0 DC 12\nR1 1 2 1k\nR2 2 0 2k\nR3 2 3 3k\nG1 0 3 0.001 R2\nR4 3 0 500';
    const nl = parseNetlistText(text);
    const r = nodeEquations(nl);
    const dc = analyze(nl, DEFAULT_ANALYSIS).result as DCResult;
    expect(r.values.v2).toBeCloseTo(dc.nodeV[2], 9);
    expect(r.values.v3).toBeCloseTo(dc.nodeV[3], 9);
    expect(r.defs).toEqual(['v_R2 = v2']);
  });

  it('7. SPICE çıktısı: test 1 devresinin .cir metni', () => {
    const nl = parseNetlistText('V1 1 0 DC 10\nR1 1 2 2\nR2 2 0 4\nR3 2 0 4');
    expect(toSpice(nl)).toBe(['* Devre Lab Simülatörü', 'V1 1 0 DC 10', 'R1 1 2 2', 'R2 2 0 4', 'R3 2 0 4', '.op', '.end'].join('\n'));
    const dep = parseNetlistText('V1 1 0 DC 10\nR1 1 2 1k\nAM1 2 0\nF1 0 3 2 AM1\nR2 3 0 500\nH1 4 0 100 R2\nR5 4 0 1k');
    expect(toSpice(dep).split('\n')).toEqual([
      '* Devre Lab Simülatörü',
      'V1 1 0 DC 10',
      'R1 1 2 1000',
      'VAM1 2 0 DC 0 ; ampermetre',
      'F1 0 3 VAM1 2',
      'R2 3 0 500',
      'EH1 4 0 3 0 0.2 ; H1 = 100·i(R2)',
      'R5 4 0 1000',
      '.op',
      '.end',
    ]);
  });
});

describe('Seri / paralel ve Kirchhoff', () => {
  it('5. Eşdeğer: 2 µF ve 3 µF seri → 1.2 µF; 10 mH ve 15 mH paralel → 6 mH', () => {
    const c = parseNetlistText('V1 1 0 DC 1\nC1 1 2 2u\nC2 2 0 3u');
    const r = seriesParallel(c, ['C1', 'C2']);
    expect(r.kind).toBe('series');
    expect(r.value).toBeCloseTo(1.2e-6, 15);
    const l = parseNetlistText('V1 1 0 DC 1\nR1 1 2 1\nL1 2 0 10m\nL2 2 0 15m');
    const p = seriesParallel(l, ['L1', 'L2']);
    expect(p.kind).toBe('parallel');
    expect(p.value).toBeCloseTo(6e-3, 15);
  });

  it('gerilim bölücü formülü ve seri gerilim kaynakları', () => {
    const nl = parseNetlistText('V1 1 0 DC 12\nR1 1 2 1k\nR2 2 0 2k');
    const r = seriesParallel(nl, ['R1', 'R2']);
    expect(r.value).toBe(3000);
    expect(r.lines.some((l) => l.includes('v_R2') && l.includes('8.00 V'))).toBe(true);
    const v = seriesParallel(parseNetlistText('V1 1 2 DC 5\nV2 2 0 DC 3\nR1 1 0 1k'), ['V1', 'V2']);
    expect(Math.abs(v.value!)).toBeCloseTo(8);
  });

  it('seri olmayan: arada başka dal varsa', () => {
    const nl = parseNetlistText('V1 1 0 DC 12\nR1 1 2 1k\nR2 2 0 2k\nR3 2 0 1k');
    expect(seriesParallel(nl, ['R1', 'R2']).kind).toBe('none');
  });

  it('KAY toplamı 0, KGY toplamı 0', () => {
    const nl = parseNetlistText('V1 1 0 DC 10\nR1 1 2 2\nR2 2 0 4\nR3 2 0 4');
    const dc = analyze(nl, DEFAULT_ANALYSIS).result as DCResult;
    const k = kclAt(nl, 2, (id) => dc.comps[id].I);
    expect(k.rows).toHaveLength(3);
    expect(Math.abs(k.sum)).toBeLessThan(1e-12);
    const l = kvlLoop(nl, 'R1', (id) => dc.comps[id].V)!;
    expect(l.rows.map((r) => r.id)).toEqual(['R1', 'R2', 'V1']);
    expect(Math.abs(l.sum)).toBeLessThan(1e-12);
  });
});
