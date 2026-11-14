// Kaynak dönüşümünü çizimde uygular: bileşenleri değiştirir ve kabloları yeniden bağlar.
import { Component, Pt, Wire, nextId, pinPositions, rotatePt } from '../core/circuit';
import type { Netlist } from '../core/netlist';
import { pathToSegments, routeWire } from '../core/route';
import type { SourceTransform } from '../solver/methods/theorems';

const add = (p: Pt, q: Pt, k = 1): Pt => [p[0] + k * q[0], p[1] + k * q[1]];
let seq = 0;
const wid = (wires: Wire[]) => {
  let id: string;
  do id = `wt${++seq}`;
  while (wires.some((w) => w.id === id));
  return id;
};

export function applySourceTransform(
  components: Component[],
  wires: Wire[],
  nl: Netlist,
  t: SourceTransform,
): { components: Component[]; wires: Wire[]; newId: string } | null {
  const src = components.find((c) => c.id === t.source);
  const res = components.find((c) => c.id === t.resistor);
  if (!src || !res || t.a === undefined || t.b === undefined || t.value === undefined) return null;
  let comps = components.filter((c) => c.id !== src.id);
  let ws = [...wires];
  const addWire = (from: Pt, to: Pt) => {
    for (const [a, b] of pathToSegments(routeWire(from, to, comps, ws))) ws.push({ id: wid(ws), from: a, to: b });
  };

  if (t.kind === 'VtoI') {
    // 1) gerilim kaynağının yerine kısa devre kablo
    const [p0, p1] = pinPositions(src);
    ws.push({ id: wid(ws), from: p0, to: p1 });
    // 2) direncin yanına paralel akım kaynağı
    const rp = pinPositions(res);
    const vertical = res.rot % 180 !== 0;
    const off: Pt = vertical ? [-4, 0] : [0, 4];
    const rNodes = nl.pinNodes[res.id];
    const m = nl.pinNodes[src.id].find((n) => rNodes.includes(n) && n !== t.a && n !== t.b);
    // b ucuna denk gelen direnç pini (ara düğüm, kaynağın dış ucuyla birleşir)
    const outerV = nl.pinNodes[src.id].find((n) => n !== m);
    const nodeOfPin = (k: number) => (rNodes[k] === m ? outerV : rNodes[k]);
    const bPin = nodeOfPin(0) === t.b ? 0 : 1;
    const id = nextId('I', comps);
    const center = add([res.x, res.y], off);
    // I'nın pin0'ı (akımın girdiği uç) b tarafında olmalı
    const local0 = rotatePt([-2, 0], res.rot);
    const pin0At = add(center, local0);
    const wantAt = add(rp[bPin], off);
    const rot = pin0At[0] === wantAt[0] && pin0At[1] === wantAt[1] ? res.rot : (res.rot + 180) % 360;
    comps = [...comps, { id, type: 'I', x: center[0], y: center[1], rot, params: { mode: 'DC', value: t.value, amp: t.value, freq: 1000, phase: 0 } }];
    ws.push({ id: wid(ws), from: rp[0], to: add(rp[0], off) });
    ws.push({ id: wid(ws), from: rp[1], to: add(rp[1], off) });
    return { components: comps, wires: ws, newId: id };
  }

  // ItoV: akım kaynağı ve paralel direnç kalkar; yerlerine seri V + R
  comps = comps.filter((c) => c.id !== res.id);
  const [q0, q1] = pinPositions(src); // q0: b düğümü (akımın girdiği uç), q1: a düğümü
  const u: Pt = [(q1[0] - q0[0]) / 4, (q1[1] - q0[1]) / 4];
  const n: Pt = [-u[1] * 3, u[0] * 3];
  // direnç hangi tarafta? onun tersine kaydır
  const side = (res.x - src.x) * n[0] + (res.y - src.y) * n[1] > 0 ? -1 : 1;
  const nn: Pt = [n[0] * side, n[1] * side];
  const vId = nextId('V', comps);
  const vMid = add(add(q0, u, 2), nn);
  // V: − ucu q0 tarafında, + ucu q1 tarafında → pin0 (+) q1 yönünde
  const vRot = (() => {
    for (const r of [0, 90, 180, 270]) {
      const p0 = add(vMid, rotatePt([-2, 0], r));
      const want = add(q1, nn);
      if (p0[0] === want[0] && p0[1] === want[1]) return r;
    }
    return src.rot;
  })();
  const V: Component = { id: vId, type: 'V', x: vMid[0], y: vMid[1], rot: vRot, params: { mode: 'DC', value: t.value, amp: t.value, freq: 1000, phase: 0 } };
  const rMid = add(vMid, u, 4);
  const R: Component = { id: res.id, type: 'R', x: rMid[0], y: rMid[1], rot: vRot, params: { value: t.R } };
  comps = [...comps, V, R];
  const [v0, v1] = pinPositions(V);
  const [r0, r1] = pinPositions(R);
  // q0 → V(−); V(+) ile R yan yana (aynı noktada birleşir); R'nin diğer ucu → q1
  const vMinus = v1;
  addWire(q0, vMinus);
  const rFar = Math.hypot(r0[0] - v0[0], r0[1] - v0[1]) < 1e-9 ? r1 : r0;
  addWire(rFar, q1);
  return { components: comps, wires: ws, newId: vId };
}
