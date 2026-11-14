// Seri / paralel bağlantı tespiti, eşdeğer değer ve bölücü formülleri (Bölüm 3.3–3.5, 7.4, 7.7).
import { formatEng } from '../../core/units';
import type { Netlist, NetElement } from '../../core/netlist';
import { sourceDC } from './nodal';

export interface SPResult {
  kind: 'series' | 'parallel' | 'none';
  lines: string[];
  /** Eşdeğer değer (R, C, L için) */
  value?: number;
}

const UNIT: Record<string, string> = { R: 'Ω', C: 'F', L: 'H', V: 'V', I: 'A' };

function degree(nl: Netlist, node: number) {
  return nl.elements.filter((e) => e.nodes[0] === node || e.nodes[1] === node).length;
}

/** Seçili elemanlar uç uca bir zincir mi? Öyleyse uç düğümlerini ve sırayı döndürür. */
function chainOf(nl: Netlist, sel: NetElement[]): { ends: [number, number]; order: { e: NetElement; dir: number }[] } | null {
  const count = new Map<number, number>();
  for (const e of sel) for (const n of e.nodes) count.set(n, (count.get(n) ?? 0) + 1);
  const ends = [...count].filter(([, c]) => c === 1).map(([n]) => n);
  if (ends.length !== 2) return null;
  for (const [n, c] of count) {
    if (c === 2 && degree(nl, n) !== 2) return null; // ara düğümde başka bir dal var
    if (c > 2) return null;
  }
  const order: { e: NetElement; dir: number }[] = [];
  let node = ends[0];
  const left = [...sel];
  while (left.length) {
    const i = left.findIndex((e) => e.nodes[0] === node || e.nodes[1] === node);
    if (i < 0) return null;
    const e = left.splice(i, 1)[0];
    const dir = e.nodes[0] === node ? 1 : -1;
    order.push({ e, dir });
    node = dir > 0 ? e.nodes[1] : e.nodes[0];
  }
  return { ends: [ends[0], ends[1]], order };
}

const fmt = (v: number, u: string) => formatEng(v, u);

export function seriesParallel(nl: Netlist, ids: string[]): SPResult {
  const sel = ids.map((id) => nl.elements.find((e) => e.id === id)).filter(Boolean) as NetElement[];
  if (sel.length < 2) return { kind: 'none', lines: [] };
  const types = new Set(sel.map((e) => e.type));
  if (types.size !== 1) return { kind: 'none', lines: ['Seri / paralel eşdeğer için aynı türde bileşenler seçin (yalnız direnç, yalnız kapasitör…).'] };
  const t = sel[0].type;
  if (!['R', 'C', 'L', 'V', 'I'].includes(t)) return { kind: 'none', lines: [] };
  const names = sel.map((e) => e.id);
  const vals = sel.map((e) => (t === 'V' || t === 'I' ? sourceDC(e) : Number(e.params.value)));
  const pairKey = (e: NetElement) => [...e.nodes].sort((a, b) => a - b).join('-');
  const parallel = sel.every((e) => pairKey(e) === pairKey(sel[0]));
  const chain = parallel ? null : chainOf(nl, sel);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const recip = (xs: number[]) => 1 / sum(xs.map((x) => 1 / x));
  const u = UNIT[t];
  const lines: string[] = [];

  if (t === 'V' || t === 'I') {
    if (t === 'V' && chain) {
      const total = sum(chain.order.map(({ e, dir }) => dir * sourceDC(e)));
      lines.push(`${names.join(', ')} seri bağlı gerilim kaynakları.`);
      lines.push(
        `Tek kaynağa indirgenir: ${chain.order.map(({ e, dir }) => `${dir > 0 ? '+' : '−'}${fmt(Math.abs(sourceDC(e)), 'V')}`).join(' ')} = ${fmt(total, 'V')} (düğüm ${chain.ends[0]} → ${chain.ends[1]} yönünde).`,
      );
      return { kind: 'series', lines, value: total };
    }
    if (t === 'I' && parallel) {
      const ref = sel[0].nodes;
      const total = sum(sel.map((e) => (e.nodes[0] === ref[0] ? 1 : -1) * sourceDC(e)));
      lines.push(`${names.join(', ')} paralel bağlı akım kaynakları.`);
      lines.push(`Tek kaynağa indirgenir: toplam ${fmt(total, 'A')} (${sel[0].id} yönünde).`);
      return { kind: 'parallel', lines, value: total };
    }
    lines.push(
      t === 'V'
        ? 'Paralel farklı gerilim kaynakları olamaz (Bölüm 3.5); bu kaynaklar seri de değil.'
        : 'Seri farklı akım kaynakları olamaz (Bölüm 3.5); bu kaynaklar paralel de değil.',
    );
    return { kind: 'none', lines };
  }

  if (!parallel && !chain) {
    return { kind: 'none', lines: [`${names.join(', ')} ne seri ne paralel: aralarında başka dallar var.`] };
  }
  const isSeries = !!chain;
  // R ve L seride toplanır; C'de kural tersidir
  const additive = (t === 'C') !== isSeries;
  const value = additive ? sum(vals) : recip(vals);
  const sym = t;
  lines.push(`${names.join(', ')} ${isSeries ? 'seri' : 'paralel'} bağlı.`);
  if (additive) lines.push(`${sym}_eş = ${names.join(' + ')} = ${vals.map((v) => fmt(v, u)).join(' + ')} = ${fmt(value, u)}`);
  else
    lines.push(
      `1/${sym}_eş = ${names.map((n) => `1/${n}`).join(' + ')} → ${sym}_eş = ${fmt(value, u)}` +
        (sel.length === 2 ? `  (iki eleman: ${names[0]}·${names[1]}/(${names[0]} + ${names[1]}))` : ''),
    );
  if (t === 'C') lines.push('Kapasitörlerde kural dirençlerin tersidir: paralelde toplanır, seride tersleri toplanır.');

  // Bölücüler
  if (t === 'R' && isSeries) {
    const [p, q] = chain!.ends;
    const src = nl.elements.find((e) => e.type === 'V' && pairKey(e) === [p, q].sort((a, b) => a - b).join('-'));
    if (src) {
      const V = Math.abs(sourceDC(src));
      lines.push(`Gerilim bölücü (${src.id} = ${fmt(V, 'V')} uçlarında):`);
      for (const e of sel) {
        const R = Number(e.params.value);
        lines.push(`v_${e.id} = V·${e.id}/R_eş = ${fmt(V, 'V')} · ${fmt(R, 'Ω')} / ${fmt(value, 'Ω')} = ${fmt((V * R) / value, 'V')}`);
      }
    }
  }
  if (t === 'R' && !isSeries) {
    const src = nl.elements.find((e) => e.type === 'I' && pairKey(e) === pairKey(sel[0]));
    if (src) {
      const I = Math.abs(sourceDC(src));
      lines.push(`Akım bölücü (${src.id} = ${fmt(I, 'A')}):`);
      for (const e of sel) {
        const R = Number(e.params.value);
        lines.push(`i_${e.id} = I·(1/${e.id})/(Σ 1/R) = I·R_eş/${e.id} = ${fmt(I, 'A')} · ${fmt(value, 'Ω')} / ${fmt(R, 'Ω')} = ${fmt((I * value) / R, 'A')}`);
      }
    }
  }
  return { kind: isSeries ? 'series' : 'parallel', lines, value };
}
