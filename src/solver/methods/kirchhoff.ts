// Kirchhoff kontrolleri (Bölüm 3.2): bir düğümde KAY, bir bileşenden geçen en kısa çevrede KGY.
import type { Netlist } from '../../core/netlist';

export interface KclRow {
  id: string;
  /** Düğümden çıkan akım (+), giren (−) */
  current: number;
}

/** Düğüme bağlı her dalın akımı; I(e) bileşenin + ucundan giren akımdır. */
export function kclAt(
  nl: Netlist,
  node: number,
  I: (id: string) => number,
  pinI?: (id: string) => number[] | undefined,
): { rows: KclRow[]; sum: number } {
  const rows: KclRow[] = [];
  for (const e of nl.elements) {
    if (e.nodes.length > 2) {
      // üç uçlu eleman: her pinden giren akım (düğümden çıkan)
      const pi = pinI?.(e.id);
      if (!pi) continue;
      let sum = 0;
      e.nodes.forEach((n, k) => n === node && (sum += pi[k]));
      if (e.nodes.includes(node) && Math.abs(sum) > 0) rows.push({ id: e.id, current: sum });
      else if (e.nodes.includes(node)) rows.push({ id: e.id, current: 0 });
      continue;
    }
    const [a, b] = e.nodes;
    if (a === b) continue;
    if (a === node) rows.push({ id: e.id, current: I(e.id) });
    else if (b === node) rows.push({ id: e.id, current: -I(e.id) });
  }
  return { rows, sum: rows.reduce((s, r) => s + r.current, 0) };
}

export interface KvlRow {
  id: string;
  /** Dolaşma yönünde gerilim düşümü */
  drop: number;
}

/** Seçili bileşenden geçen en kısa kapalı yol; V(e) = v(+) − v(−). */
export function kvlLoop(nl: Netlist, id: string, V: (id: string) => number): { rows: KvlRow[]; sum: number } | null {
  const start = nl.elements.find((e) => e.id === id);
  if (!start) return null;
  const [a, b] = start.nodes;
  if (a === b) return { rows: [{ id, drop: 0 }], sum: 0 };
  // b'den a'ya, start dışındaki elemanlar üzerinden en kısa yol (BFS)
  const prev = new Map<number, { from: number; id: string; sign: number }>();
  const seen = new Set([b]);
  const q = [b];
  while (q.length) {
    const u = q.shift()!;
    if (u === a) break;
    for (const e of nl.elements) {
      if (e.id === id || e.nodes.length > 2) continue;
      const [p, r] = e.nodes;
      const v = p === u ? r : r === u ? p : -1;
      if (v < 0 || seen.has(v)) continue;
      seen.add(v);
      prev.set(v, { from: u, id: e.id, sign: p === u ? 1 : -1 });
      q.push(v);
    }
  }
  if (!seen.has(a)) return null;
  const path: KvlRow[] = [];
  let x = a;
  while (x !== b) {
    const st = prev.get(x)!;
    path.unshift({ id: st.id, drop: st.sign * V(st.id) });
    x = st.from;
  }
  const rows = [{ id, drop: V(id) }, ...path];
  return { rows, sum: rows.reduce((s, r) => s + r.drop, 0) };
}
