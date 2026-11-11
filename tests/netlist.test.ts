import { describe, expect, it } from 'vitest';
import type { Component, Wire } from '../src/core/circuit';
import { buildNetlist } from '../src/core/netlist';
import { DEFAULT_ANALYSIS } from '../src/core/circuit';
import { analyze } from '../src/solver/analyze';
import type { DCResult } from '../src/core/results';

// Çizilmiş bir gerilim bölücü: V1 dikey (x=0), R1 yatay üstte, R2 dikey sağda, GND altta.
const comps: Component[] = [
  { id: 'V1', type: 'V', x: 0, y: 4, rot: 90, params: { mode: 'DC', value: 12 } }, // pinler (0,2) + ve (0,6)
  { id: 'R1', type: 'R', x: 4, y: 0, rot: 0, params: { value: 1000 } }, // (2,0) (6,0)
  { id: 'R2', type: 'R', x: 8, y: 4, rot: 90, params: { value: 2000 } }, // (8,2) (8,6)
  { id: 'GND1', type: 'GND', x: 4, y: 8, rot: 0, params: {} }, // (4,8)
];
const wires: Wire[] = [
  { id: 'w1', from: [0, 2], to: [0, 0] },
  { id: 'w2', from: [0, 0], to: [2, 0] },
  { id: 'w3', from: [6, 0], to: [8, 0] },
  { id: 'w4', from: [8, 0], to: [8, 2] },
  { id: 'w5', from: [0, 6], to: [0, 8] },
  { id: 'w6', from: [0, 8], to: [8, 8] }, // GND (4,8) bu kablonun ortasına düşüyor (T bağlantı)
  { id: 'w7', from: [8, 8], to: [8, 6] },
];

describe('netlist çıkarma', () => {
  it('union-find ile düğümleri bulur', () => {
    const nl = buildNetlist(comps, wires);
    expect(nl.issues).toEqual([]);
    expect(nl.nodeCount).toBe(2);
    expect(nl.pinNodes.V1[1]).toBe(0);
    expect(nl.pinNodes.R2[1]).toBe(0);
    expect(nl.pinNodes.V1[0]).toBe(nl.pinNodes.R1[0]);
  });

  it('çizilen gerilim bölücü elle hesaplanan değeri verir', () => {
    const out = analyze(buildNetlist(comps, wires), DEFAULT_ANALYSIS);
    expect(out.ok).toBe(true);
    const r = out.result as DCResult;
    expect(r.comps.R2.V).toBeCloseTo(8, 6);
    expect(r.comps.R1.I).toBeCloseTo(4e-3, 9);
  });

  it('toprak yok uyarısı', () => {
    const nl = buildNetlist(comps.filter((c) => c.type !== 'GND'), wires);
    expect(nl.issues.some((i) => /Toprak yok/.test(i.message))).toBe(true);
  });

  it('boştaki uç yakalanır', () => {
    const nl = buildNetlist(comps, wires.filter((w) => w.id !== 'w4'));
    const iss = nl.issues.find((i) => /Boştaki uç/.test(i.message));
    expect(iss?.compIds).toContain('R2');
  });
});
