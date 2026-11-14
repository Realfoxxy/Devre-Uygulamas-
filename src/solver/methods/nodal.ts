// Düğüm gerilimleri yöntemi (Bölüm 4.2–4.4): öğrencinin yazacağı biçimde KAY denklemleri,
// süperdüğümler, kısıt denklemleri ve G·v = i matrisi. Dirençli (DC) devre için yazılır:
// kapasitör açık devre, bobin kısa devre (0 V kaynak) sayılır.
import type { Netlist, NetElement } from '../../core/netlist';
import { sourceBefore } from '../waveform';
import { Lin, Term, joinTerms, lin, linAdd, linEquation, linScale, linSystem, linVar, negateText, num, solveDense } from './linear';

export interface EqLine {
  title: string;
  /** Öğrencinin yazacağı biçim */
  text: string;
  /** Sadeleşmiş biçim (katsayılar toplanmış) */
  simplified: string;
}

export interface MethodResult {
  ok: boolean;
  message?: string;
  unknowns: string[];
  /** Denklem yazmadan doğrudan bilinen değerler (v1 = 10 V, i2 = −3 A) */
  given: string[];
  /** Kontrol büyüklüğü tanımları (v_x = v2 − v3) */
  defs: string[];
  equations: EqLine[];
  A: number[][];
  b: number[];
  solution: number[] | null;
  /** Bilinen değerler dahil tüm büyüklükler */
  values: Record<string, number>;
}

const VOLT = new Set(['V', 'AM', 'L', 'E', 'H']);

const vName = (n: number) => `v${n}`;

export function nodeEquations(nl: Netlist): MethodResult & { supernodes: number[][] } {
  const fail = (message: string) => ({
    ok: false,
    message,
    unknowns: [],
    given: [],
    defs: [],
    equations: [],
    A: [],
    b: [],
    solution: null,
    values: {},
    supernodes: [],
  });
  const els = nl.elements.filter((e) => e.type !== 'C' && e.type !== 'VM');
  const byId = new Map(nl.elements.map((e) => [e.id, e]));
  const n = nl.nodeCount;

  // Gerilim tipi elemanların oluşturduğu bileşenler (süperdüğümler)
  const parent = Array.from({ length: n + 1 }, (_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  for (const e of els) if (VOLT.has(e.type)) parent[find(e.nodes[0])] = find(e.nodes[1]);
  const groups = new Map<number, number[]>();
  for (let k = 0; k <= n; k++) {
    const r = find(k);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(k);
  }
  const groundGroup = groups.get(find(0))!;

  // Toprağa bağımsız gerilim kaynağı zinciriyle bağlı düğümlerin değeri doğrudan bilinir
  const known = new Map<number, number>([[0, 0]]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of els) {
      if (e.type !== 'V' && e.type !== 'AM' && e.type !== 'L') continue;
      const V = e.type === 'V' ? sourceDC(e) : 0;
      const [a, b] = e.nodes;
      if (known.has(b) && !known.has(a)) {
        known.set(a, known.get(b)! + V);
        grew = true;
      } else if (known.has(a) && !known.has(b)) {
        known.set(b, known.get(a)! - V);
        grew = true;
      }
    }
  }

  const unknowns: string[] = [];
  for (let k = 1; k <= n; k++) if (!known.has(k)) unknowns.push(vName(k));
  const given = [...known].filter(([k]) => k !== 0).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${vName(k)} = ${num(v)} V`);

  // Düğüm gerilimi: bilinmeyen ya da sayı
  const volt = (k: number): Term => {
    if (known.has(k)) return { text: num(known.get(k)!), lin: lin(known.get(k)!) };
    return { text: vName(k), lin: linVar(vName(k)) };
  };
  const diff = (p: number, q: number): Term => {
    const a = volt(p);
    if (q === 0) return a;
    const b = volt(q);
    if (p === 0) return { text: `−${b.text}`, lin: linScale(b.lin, -1) };
    return { text: `${a.text} − ${b.text}`, lin: linAdd(a.lin, b.lin, -1) };
  };

  const defs: string[] = [];
  const defined = new Set<string>();
  let unsupported: string | null = null;

  // Kontrol gerilimi v(ref) düğüm gerilimleriyle
  const ctrlVoltage = (ref: NetElement): Term => {
    const sym = `v_${ref.id}`;
    const d = diff(ref.nodes[0], ref.nodes[1]);
    if (!defined.has(sym)) {
      defined.add(sym);
      defs.push(`${sym} = ${d.text}`);
    }
    return { text: sym, lin: d.lin };
  };

  // Bir elemanın (+ uçtan giren) akımı düğüm gerilimleriyle; yazılamıyorsa null
  const currentOf = (e: NetElement, depth = 0): Term | null => {
    if (depth > 4) return null;
    switch (e.type) {
      case 'R': {
        const d = diff(e.nodes[0], e.nodes[1]);
        const R = Number(e.params.value);
        const body = e.nodes[1] === 0 || e.nodes[0] === 0 ? d.text : `(${d.text})`;
        return { text: `${body}/${num(R)}`, lin: linScale(d.lin, 1 / R) };
      }
      case 'I': {
        const I = sourceDC(e);
        return { text: num(I), lin: lin(I) };
      }
      case 'G': {
        const ref = byId.get(e.params.ctrl?.ref ?? '');
        if (!ref) return null;
        const v = ctrlVoltage(ref);
        const g = Number(e.params.gain ?? 0);
        return { text: `${num(g)}·${v.text}`, lin: linScale(v.lin, g) };
      }
      case 'F': {
        const ref = byId.get(e.params.ctrl?.ref ?? '');
        if (!ref) return null;
        const i = ctrlCurrent(ref, depth + 1);
        if (!i) return null;
        const g = Number(e.params.gain ?? 0);
        return { text: `${num(g)}·${i.text}`, lin: linScale(i.lin, g) };
      }
      default:
        return null;
    }
  };

  // Kontrol akımı: R için v/R; dal akımlı elemanlar için uç düğümündeki KAY'dan
  const ctrlCurrent = (ref: NetElement, depth: number): Term | null => {
    const sym = `i_${ref.id}`;
    let expr: Term | null = null;
    if (ref.type === 'R' || ref.type === 'I') expr = currentOf(ref, depth);
    else if (ref.type === 'C' || ref.type === 'VM') expr = { text: '0', lin: lin(0) };
    else {
      // + uçtaki (sonra − uçtaki) düğümde diğer elemanların akımları yazılabiliyorsa KAY ile bulunur
      for (const [pin, sign] of [
        [0, -1],
        [1, 1],
      ] as const) {
        const node = ref.nodes[pin];
        if (node === 0) continue;
        const others = els.filter((o) => o.id !== ref.id && (o.nodes[0] === node || o.nodes[1] === node));
        let total = lin(0);
        const texts: string[] = [];
        let okk = true;
        for (const o of others) {
          if (o.nodes[0] === node && o.nodes[1] === node) continue;
          const io = leavingCurrent(o, node, depth);
          if (!io) {
            okk = false;
            break;
          }
          total = linAdd(total, io.lin);
          texts.push(sign < 0 ? negateText(io.text) : io.text);
        }
        if (!okk) continue;
        // ref'ten düğümden ayrılan akım + diğerleri = 0
        expr = { text: joinTerms(texts), lin: linScale(total, sign) };
        break;
      }
    }
    if (!expr) return null;
    if (!defined.has(sym)) {
      defined.add(sym);
      defs.push(`${sym} = ${expr.text}`);
    }
    return { text: sym, lin: expr.lin };
  };

  /** e elemanından node düğümünden dışarı çıkan akım (R için metin o düğümden dışarı yazılır) */
  function leavingCurrent(e: NetElement, node: number, depth = 0): Term | null {
    const out = e.nodes[0] === node;
    if (e.type === 'R') {
      const o = out ? e.nodes[1] : e.nodes[0];
      const d = diff(node, o);
      const R = Number(e.params.value);
      return { text: `${o === 0 ? d.text : `(${d.text})`}/${num(R)}`, lin: linScale(d.lin, 1 / R) };
    }
    const i = currentOf(e, depth);
    if (!i) return null;
    return out ? i : { text: negateText(i.text), lin: linScale(i.lin, -1) };
  }

  const equations: EqLine[] = [];
  const rows: Lin[] = [];
  const supernodes: number[][] = [];

  const constraint = (e: NetElement): void => {
    const [a, b] = e.nodes;
    const d = diff(a, b);
    let rhs: Term;
    if (e.type === 'V') rhs = { text: num(sourceDC(e)), lin: lin(sourceDC(e)) };
    else if (e.type === 'AM' || e.type === 'L') rhs = { text: '0', lin: lin(0) };
    else {
      const ref = byId.get(e.params.ctrl?.ref ?? '');
      const g = Number(e.params.gain ?? 0);
      const c = ref ? (e.type === 'E' ? ctrlVoltage(ref) : ctrlCurrent(ref, 0)) : null;
      if (!c) {
        unsupported = `${e.id}'in kontrol akımı düğüm gerilimleriyle doğrudan yazılamıyor; MNA sekmesine bakın.`;
        return;
      }
      rhs = { text: `${num(g)}·${c.text}`, lin: linScale(c.lin, g) };
    }
    const row = linAdd(d.lin, rhs.lin, -1);
    rows.push(row);
    equations.push({ title: `${e.id} kısıtı`, text: `${d.text} = ${rhs.text}`, simplified: linEquation(row, unknowns) });
  };

  const kcl = (set: number[], title: string): void => {
    const inSet = new Set(set);
    const texts: string[] = [];
    let total = lin(0);
    for (const e of els) {
      if (VOLT.has(e.type)) continue;
      const a = inSet.has(e.nodes[0]);
      const b = inSet.has(e.nodes[1]);
      if (a === b) continue;
      // R için metni küme içindeki düğümden dışarı doğru yaz
      if (e.type === 'R') {
        const s = a ? e.nodes[0] : e.nodes[1];
        const o = a ? e.nodes[1] : e.nodes[0];
        const d = diff(s, o);
        const R = Number(e.params.value);
        const body = o === 0 ? d.text : `(${d.text})`;
        texts.push(`${body}/${num(R)}`);
        total = linAdd(total, linScale(d.lin, 1 / R));
        continue;
      }
      const i = leavingCurrent(e, a ? e.nodes[0] : e.nodes[1]);
      if (!i) {
        unsupported = `${e.id}'in akımı düğüm gerilimleriyle doğrudan yazılamıyor; MNA sekmesine bakın.`;
        return;
      }
      texts.push(i.text);
      total = linAdd(total, i.lin);
    }
    rows.push(total);
    equations.push({ title, text: `${joinTerms(texts)} = 0`, simplified: linEquation(total, unknowns) });
  };

  for (const g of groups.values()) {
    if (g === groundGroup) {
      // toprak grubundaki bağımlı kaynak kısıtları
      for (const e of els) if (VOLT.has(e.type) && g.includes(e.nodes[0]) && !(known.has(e.nodes[0]) && known.has(e.nodes[1]))) constraint(e);
      continue;
    }
    if (g.length === 1) {
      kcl(g, `Düğüm ${g[0]} (KAY)`);
      continue;
    }
    const sorted = [...g].sort((x, y) => x - y);
    supernodes.push(sorted);
    kcl(sorted, `Süperdüğüm {${sorted.join(', ')}} (KAY)`);
    for (const e of els) if (VOLT.has(e.type) && g.includes(e.nodes[0])) constraint(e);
  }
  if (unsupported) return fail(unsupported);

  // Satırları bilinmeyen sırasına göre (düğüm numarası) diz
  const { A, b } = linSystem(rows, unknowns);
  const solution = unknowns.length ? solveDense(A, b) : [];
  const values: Record<string, number> = {};
  for (const [k, v] of known) if (k) values[vName(k)] = v;
  if (solution) unknowns.forEach((u, i) => (values[u] = solution[i]));
  return { ok: true, unknowns, given, defs, equations, A, b, solution, values, supernodes };
}

/** DC analizde kaynağın değeri (t < 0 değeri; AC kaynaklar 0) */
export function sourceDC(e: NetElement): number {
  return sourceBefore(e);
}
