import { describe, expect, it } from 'vitest';
import type { Component, Pt, Wire } from '../src/core/circuit';
import { pinPositions } from '../src/core/circuit';
import { bodyRect, routeWire } from '../src/core/route';

const R = (id: string, x: number, y: number, rot = 0): Component => ({ id, type: 'R', x, y, rot, params: { value: 1000 } });

function segs(path: Pt[]) {
  const out: [Pt, Pt][] = [];
  for (let i = 0; i + 1 < path.length; i++) out.push([path[i], path[i + 1]]);
  return out;
}
const crosses = (path: Pt[], c: Component) => {
  const r = bodyRect(c);
  return segs(path).some(([a, b]) => Math.max(a[0], b[0]) >= r.x0 && Math.min(a[0], b[0]) <= r.x1 && Math.max(a[1], b[1]) >= r.y0 && Math.min(a[1], b[1]) <= r.y1);
};

describe('kablo yönlendirme', () => {
  it('engel yoksa basit L yolu', () => {
    const p = routeWire([0, 0], [5, 3], [], []);
    expect(p).toEqual([[0, 0], [5, 0], [5, 3]]);
  });

  it('düz hat tek parça', () => {
    expect(routeWire([0, 0], [6, 0], [], [])).toEqual([[0, 0], [6, 0]]);
  });

  it('aradaki bileşenin üstünden geçmez', () => {
    const block = R('R9', 5, 0); // (3,0)-(7,0) arasında yatay direnç
    const p = routeWire([0, 0], [10, 0], [block], []);
    expect(crosses(p, block)).toBe(false);
    expect(p[0]).toEqual([0, 0]);
    expect(p[p.length - 1]).toEqual([10, 0]);
  });

  it('yol üzerindeki başka bir pine değmez', () => {
    const other = R('R8', 5, 5, 90); // pinler (5,3) ve (5,7)
    const pins = pinPositions(other);
    const p = routeWire([0, 3], [10, 3], [other], []);
    const touches = segs(p).some(([a, b]) =>
      pins.some((q) => (a[1] === b[1] && q[1] === a[1] && q[0] >= Math.min(a[0], b[0]) && q[0] <= Math.max(a[0], b[0])) ||
        (a[0] === b[0] && q[0] === a[0] && q[1] >= Math.min(a[1], b[1]) && q[1] <= Math.max(a[1], b[1]))),
    );
    expect(touches).toBe(false);
  });

  it('mevcut kabloyla üst üste binmez', () => {
    const w: Wire = { id: 'w1', from: [0, 2], to: [10, 2] };
    const p = routeWire([0, 0], [10, 4], [], [w]);
    // köşe noktaları y=2 kablosunun üzerinde olmamalı
    expect(p.slice(1, -1).some((q) => q[1] === 2)).toBe(false);
  });
});
