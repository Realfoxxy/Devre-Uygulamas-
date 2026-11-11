// Kablo yönlendirme: iki nokta arasında bileşenlerin üstünden geçmeyen,
// başka pin / kablo uçlarına istemeden değmeyen dik açılı bir yol seçer.
import { Component, Pt, Wire, pinPositions, ptKey, rotatePt, samePt } from './circuit';

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Bileşen gövdesinin ızgara birimindeki dikdörtgeni (pin noktaları hariç). */
export function bodyRect(c: Component): Rect {
  if (c.type === 'GND') {
    const pts = ([[-0.7, 0.2], [0.7, 1.2]] as Pt[]).map((p) => rotatePt(p, c.rot));
    return {
      x0: c.x + Math.min(pts[0][0], pts[1][0]),
      y0: c.y + Math.min(pts[0][1], pts[1][1]),
      x1: c.x + Math.max(pts[0][0], pts[1][0]),
      y1: c.y + Math.max(pts[0][1], pts[1][1]),
    };
  }
  const vertical = c.rot % 180 !== 0;
  const a = 1.8; // eksen boyunca (pinler ±2'de)
  const p = 0.9; // eksene dik
  return vertical
    ? { x0: c.x - p, y0: c.y - a, x1: c.x + p, y1: c.y + a }
    : { x0: c.x - a, y0: c.y - p, x1: c.x + a, y1: c.y + p };
}

/** İsim / değer yazısının kapladığı yaklaşık alan (ızgara birimi). */
export function labelRect(c: Component): Rect | null {
  if (c.type === 'GND') return null;
  return c.rot % 180 !== 0
    ? { x0: c.x + 1.1, y0: c.y - 0.9, x1: c.x + 5, y1: c.y + 0.9 }
    : { x0: c.x - 2, y0: c.y - 2.4, x1: c.x + 2, y1: c.y - 0.75 };
}

/** Eksene paralel bir doğru parçası dikdörtgeni kesiyor mu? */
function segHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  const sx0 = Math.min(a[0], b[0]);
  const sx1 = Math.max(a[0], b[0]);
  const sy0 = Math.min(a[1], b[1]);
  const sy1 = Math.max(a[1], b[1]);
  return sx1 >= r.x0 && sx0 <= r.x1 && sy1 >= r.y0 && sy0 <= r.y1;
}

/** p, [a,b] parçasının üzerinde mi (uçlar dahil) */
function onSeg(p: Pt, a: Pt, b: Pt): boolean {
  if (a[0] === b[0]) return p[0] === a[0] && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
  if (a[1] === b[1]) return p[1] === a[1] && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]);
  return false;
}

/** İki eksene paralel parçanın aynı doğru üzerindeki ortak uzunluğu */
function overlapLen(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (a[1] === b[1] && c[1] === d[1] && a[1] === c[1]) {
    return Math.max(0, Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])));
  }
  if (a[0] === b[0] && c[0] === d[0] && a[0] === c[0]) {
    return Math.max(0, Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])));
  }
  return 0;
}

/** Ardışık aynı / doğrusal noktaları temizler. */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.length || !samePt(out[out.length - 1], p)) out.push(p);
  for (let i = 1; i < out.length - 1; ) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
    if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) out.splice(i, 1);
    else i++;
  }
  return out;
}

export function routeCost(path: Pt[], from: Pt, to: Pt, components: Component[], wires: Wire[]): number {
  let cost = 0;
  const segs: [Pt, Pt][] = [];
  for (let i = 0; i + 1 < path.length; i++) segs.push([path[i], path[i + 1]]);
  // 1) bileşen gövdesinin üstünden geçme
  for (const c of components) {
    const r = bodyRect(c);
    for (const [a, b] of segs) if (segHitsRect(a, b, r)) cost += 1000;
    const l = labelRect(c);
    if (l) for (const [a, b] of segs) if (segHitsRect(a, b, l)) cost += 25;
  }
  // 2) yol üzerinde kalan başka pin / kablo ucu (istenmeyen bağlantı)
  const pts = new Map<string, Pt>();
  for (const c of components) for (const p of pinPositions(c)) pts.set(ptKey(p), p);
  for (const w of wires) {
    pts.set(ptKey(w.from), w.from);
    pts.set(ptKey(w.to), w.to);
  }
  for (const [, p] of pts) {
    if (samePt(p, from) || samePt(p, to)) continue;
    if (segs.some(([a, b]) => onSeg(p, a, b))) cost += 400;
  }
  // 3) köşelerin mevcut bir kablonun üstüne düşmesi (T bağlantısı oluşturur)
  for (const q of path.slice(1, -1)) if (wires.some((w) => onSeg(q, w.from, w.to))) cost += 400;
  // 4) mevcut kabloyla üst üste binme
  for (const w of wires) for (const [a, b] of segs) cost += overlapLen(a, b, w.from, w.to) * 200;
  // 5) uzunluk ve köşe sayısı
  for (const [a, b] of segs) cost += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
  cost += (path.length - 2) * 0.6;
  return cost;
}

/**
 * a'dan b'ye kablo yolu. Aday yollar: yatay-dikey, dikey-yatay ve aradan dolaşan
 * üç parçalı yollar. En düşük maliyetli olan seçilir.
 */
export function routeWire(a: Pt, b: Pt, components: Component[], wires: Wire[], prefer: 'h' | 'v' = 'h'): Pt[] {
  if (samePt(a, b)) return [a];
  const cands: Pt[][] = [
    [a, [b[0], a[1]], b],
    [a, [a[0], b[1]], b],
  ];
  const minX = Math.min(a[0], b[0]);
  const maxX = Math.max(a[0], b[0]);
  const minY = Math.min(a[1], b[1]);
  const maxY = Math.max(a[1], b[1]);
  const M = 6;
  for (let x = minX - M; x <= maxX + M; x++) cands.push([a, [x, a[1]], [x, b[1]], b]);
  for (let y = minY - M; y <= maxY + M; y++) cands.push([a, [a[0], y], [b[0], y], b]);
  let best: Pt[] = cands[prefer === 'h' ? 0 : 1];
  let bestCost = Infinity;
  cands.forEach((c, i) => {
    const path = simplify(c);
    // tercih edilen basit L yoluna küçük bir avantaj
    const bias = i === (prefer === 'h' ? 0 : 1) ? -0.3 : 0;
    const cost = routeCost(path, a, b, components, wires) + bias;
    if (cost < bestCost) {
      bestCost = cost;
      best = path;
    }
  });
  return best;
}

export function pathToSegments(path: Pt[]): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (let i = 0; i + 1 < path.length; i++) out.push([path[i], path[i + 1]]);
  return out;
}
