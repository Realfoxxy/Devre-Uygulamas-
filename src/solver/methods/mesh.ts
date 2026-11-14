// Çevre akımları yöntemi (Bölüm 4.5–4.7). Çevreler çizimin düzlemsel yerleşiminden bulunur:
// kablolar ızgarada olduğu için çizim bir düzlem grafiğidir ve iç yüzleri çevrelerdir.
// Dirençli (DC) devre için yazılır: kapasitör ve voltmetre açık devre, bobin kısa devre.
import { Component, Pt, Wire, pinPositions, ptKey } from '../../core/circuit';
import type { Netlist, NetElement } from '../../core/netlist';
import { EqLine, MethodResult, sourceDC } from './nodal';
import { Lin, joinTerms, lin, linAdd, linEquation, linScale, linSystem, linVar, num, solveDense } from './linear';

export interface Mesh {
  name: string;
  /** Çizimdeki ağırlık merkezi (ızgara) — "i1 ↻" etiketi için */
  center: Pt;
  /** Saat yönünde dolaşırken geçilen elemanlar ve yön (+1: + uçtan − uca) */
  elements: { id: string; d: number }[];
}

export interface MeshResult extends MethodResult {
  meshes: Mesh[];
  supermeshes: string[][];
  /** Eleman akımı = Σ katsayı · i_k (+ uçtan giren yön) */
  branchCurrents: Record<string, Lin>;
}

const OPEN = new Set(['C', 'VM']);
const CURRENT_SRC = new Set(['I', 'G', 'F']);

interface Edge {
  a: string;
  b: string;
  /** eleman kenarıysa id ve a'nın + uç olup olmadığı */
  el?: string;
  plus?: boolean;
}

function segIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}
const onSegStrict = (p: Pt, a: Pt, b: Pt) => {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) > 1e-9) return false;
  const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
  const len = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  return dot > 1e-9 && dot < len - 1e-9;
};

const fail = (message: string): MeshResult => ({
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
  meshes: [],
  supermeshes: [],
  branchCurrents: {},
});

export function meshEquations(components: Component[], wires: Wire[], nl: Netlist): MeshResult {
  const multi = nl.elements.find((e) => e.nodes.length > 2 || e.type === 'TS' || ((e.type === 'VM' || e.type === 'AM') && e.params.real));
  if (multi)
    return fail(
      `Çevre denklemleri ${multi.id} (${multi.type === 'OA' ? 'op-amp' : multi.type === 'POT' ? 'potansiyometre' : multi.type === 'SW2' ? 'anahtar' : multi.type === 'TS' ? 'sıcaklık sensörü' : 'gerçek ölçü aleti'}) içeren devrelerde yazılmıyor; düğüm yöntemini kullanın.`,
    );
  const elById = new Map(nl.elements.map((e) => [e.id, e]));
  const pts = new Map<string, Pt>();
  const addPt = (p: Pt) => pts.set(ptKey(p), p);
  const edges: Edge[] = [];

  // Kablo uçları (elektriksel birleşme noktaları)
  const wireEnds = new Set<string>();
  for (const w of wires) {
    wireEnds.add(ptKey(w.from));
    wireEnds.add(ptKey(w.to));
    addPt(w.from);
    addPt(w.to);
  }
  // Kabloları, ortalarına denk gelen kablo uçlarından böl
  const endPts = [...wireEnds].map((k) => pts.get(k)!);
  for (const w of wires) {
    const inner = endPts.filter((p) => onSegStrict(p, w.from, w.to));
    inner.sort((p, q) => Math.hypot(p[0] - w.from[0], p[1] - w.from[1]) - Math.hypot(q[0] - w.from[0], q[1] - w.from[1]));
    const chain = [w.from, ...inner, w.to];
    for (let i = 0; i + 1 < chain.length; i++) edges.push({ a: ptKey(chain[i]), b: ptKey(chain[i + 1]) });
  }
  const grounds: string[] = [];
  for (const c of components) {
    const ps = pinPositions(c);
    ps.forEach(addPt);
    if (c.type === 'GND') {
      grounds.push(ptKey(ps[0]));
      continue;
    }
    const e = elById.get(c.id);
    if (!e || OPEN.has(c.type)) continue;
    edges.push({ a: ptKey(ps[0]), b: ptKey(ps[1]), el: c.id, plus: true });
  }

  // Düzlemsellik: kesişen ama bağlı olmayan kenarlar ya da bir kenarın ortasına değen uç
  const geom = edges.map((e) => [pts.get(e.a)!, pts.get(e.b)!] as [Pt, Pt]);
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [p1, p2] = geom[i];
      const [p3, p4] = geom[j];
      if (segIntersect(p1, p2, p3, p4) || onSegStrict(p3, p1, p2) || onSegStrict(p4, p1, p2) || onSegStrict(p1, p3, p4) || onSegStrict(p2, p3, p4)) {
        const names = [edges[i].el, edges[j].el].filter(Boolean).join(' ve ');
        return fail(
          `Bu devre düzlemsel çizilmemiş${names ? ` (${names} çevresinde)` : ''}: kesişen ama bağlı olmayan kablolar var. Çevre yöntemi uygulanamaz; kesişmeyi kaldırırsanız çalışır. Düğüm yöntemi her durumda çalışır.`,
        );
      }
    }
  }

  // Birden fazla toprak sembolü farklı yerlerdeyse çizimde görünmeyen bir bağlantı vardır
  const adj = new Map<string, number[]>();
  edges.forEach((e, i) => {
    if (e.a === e.b) return;
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(i);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(i);
  });
  const comp = new Map<string, number>();
  let nComp = 0;
  for (const start of adj.keys()) {
    if (comp.has(start)) continue;
    const stack = [start];
    comp.set(start, nComp);
    while (stack.length) {
      const u = stack.pop()!;
      for (const i of adj.get(u) ?? []) {
        const v = edges[i].a === u ? edges[i].b : edges[i].a;
        if (!comp.has(v)) {
          comp.set(v, nComp);
          stack.push(v);
        }
      }
    }
    nComp++;
  }
  const gComps = new Set(grounds.map((g) => comp.get(g)).filter((x) => x !== undefined));
  if (gComps.size > 1 || nComp > 1)
    return fail('Çevre yöntemi için devre tek parça çizilmeli: toprak sembolleri kablolarla birbirine bağlı olmalı (tek toprak noktası kullanın).');

  // Uçta kalan dalları (derece 1) budayıp yüzleri bul
  const alive = edges.map((e) => e.a !== e.b);
  let changed = true;
  while (changed) {
    changed = false;
    const deg = new Map<string, number>();
    edges.forEach((e, i) => {
      if (!alive[i]) return;
      deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
      deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
    });
    edges.forEach((e, i) => {
      if (alive[i] && (deg.get(e.a) === 1 || deg.get(e.b) === 1)) {
        alive[i] = false;
        changed = true;
      }
    });
  }
  // Yarım kenarlar: her köşede açıya göre sıralı
  const out = new Map<string, { to: string; edge: number; ang: number }[]>();
  edges.forEach((e, i) => {
    if (!alive[i]) return;
    const pa = pts.get(e.a)!;
    const pb = pts.get(e.b)!;
    (out.get(e.a) ?? out.set(e.a, []).get(e.a)!).push({ to: e.b, edge: i, ang: Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) });
    (out.get(e.b) ?? out.set(e.b, []).get(e.b)!).push({ to: e.a, edge: i, ang: Math.atan2(pa[1] - pb[1], pa[0] - pb[0]) });
  });
  for (const l of out.values()) l.sort((x, y) => x.ang - y.ang);
  const used = new Set<string>();
  const faces: { half: { from: string; to: string; edge: number }[]; area: number }[] = [];
  for (const [u, list] of out) {
    for (const h of list) {
      const key0 = `${u}>${h.to}>${h.edge}`;
      if (used.has(key0)) continue;
      const half: { from: string; to: string; edge: number }[] = [];
      let from = u;
      let cur = h;
      let guard = 0;
      while (guard++ < 10000) {
        const key = `${from}>${cur.to}>${cur.edge}`;
        if (used.has(key)) break;
        used.add(key);
        half.push({ from, to: cur.to, edge: cur.edge });
        // varılan köşede, geri dönüş kenarından açı sırasında bir önceki kenar
        const lst = out.get(cur.to)!;
        const back = lst.findIndex((x) => x.to === from && x.edge === cur.edge);
        const next = lst[(back - 1 + lst.length) % lst.length];
        from = cur.to;
        cur = next;
      }
      let area = 0;
      for (const s of half) {
        const p = pts.get(s.from)!;
        const q = pts.get(s.to)!;
        area += p[0] * q[1] - q[0] * p[1];
      }
      faces.push({ half, area: area / 2 });
    }
  }
  if (faces.length <= 1) {
    // çevre yoksa (ağaç biçimli devre) denklem yok
  }
  // En büyük alanlı yüz dış yüzdür
  let outer = 0;
  faces.forEach((f, i) => {
    if (Math.abs(f.area) > Math.abs(faces[outer].area)) outer = i;
  });
  const inner = faces.filter((_, i) => i !== outer && Math.abs(faces[i].area) > 1e-9);

  // Saat yönü (ekranda y aşağı: pozitif alan saat yönüdür); merkeze göre sırala (soldan sağa, yukarıdan aşağı)
  const meshesRaw = inner.map((f) => {
    const half = f.area < 0 ? [...f.half].reverse().map((s) => ({ from: s.to, to: s.from, edge: s.edge })) : f.half;
    let cx = 0;
    let cy = 0;
    for (const s of half) {
      const p = pts.get(s.from)!;
      cx += p[0];
      cy += p[1];
    }
    return { half, center: [cx / half.length, cy / half.length] as Pt };
  });
  meshesRaw.sort((m1, m2) => (Math.abs(m1.center[0] - m2.center[0]) > 0.5 ? m1.center[0] - m2.center[0] : m1.center[1] - m2.center[1]));

  const meshes: Mesh[] = meshesRaw.map((m, k) => ({
    name: `i${k + 1}`,
    center: m.center,
    elements: m.half
      .filter((s) => edges[s.edge].el)
      .map((s) => ({ id: edges[s.edge].el!, d: s.from === edges[s.edge].a ? 1 : -1 })),
  }));
  const unknowns = meshes.map((m) => m.name);
  if (!meshes.length) return fail('Devrede kapalı çevre yok; çevre denklemi yazılamaz.');

  // Eleman akımları: + uçtan giren yön = Σ d · i_k
  const branch: Record<string, Lin> = {};
  for (const e of nl.elements) branch[e.id] = lin(0);
  for (const m of meshes) for (const x of m.elements) branch[x.id] = linAdd(branch[x.id], linVar(m.name, x.d));

  const defs: string[] = [];
  const defined = new Set<string>();
  let unsupported: string | null = null;
  const fmtLin = (l: Lin, first?: string) => {
    const t = [...l.c].filter(([, v]) => Math.abs(v) > 1e-12).sort(([a], [b]) => (a === first ? -1 : b === first ? 1 : 0));
    if (!t.length) return num(l.k);
    return joinTerms(t.map(([n, v]) => (Math.abs(Math.abs(v) - 1) < 1e-12 ? (v < 0 ? `−${n}` : n) : `${num(v)}·${n}`)));
  };

  // İki düğüm arası gerilim, gerilimi bilinen elemanlardan geçen bir yol boyunca
  const voltageBetween = (p: number, q: number): Lin | null => {
    if (p === q) return lin(0);
    const prev = new Map<number, { from: number; e: NetElement; sign: number }>();
    const seen = new Set([p]);
    const queue = [p];
    while (queue.length) {
      const u = queue.shift()!;
      for (const e of nl.elements) {
        if (!['R', 'V', 'AM', 'L'].includes(e.type)) continue;
        const [a, b] = e.nodes;
        const v = a === u ? b : b === u ? a : -1;
        if (v < 0 || seen.has(v)) continue;
        seen.add(v);
        prev.set(v, { from: u, e, sign: a === u ? 1 : -1 });
        queue.push(v);
      }
    }
    if (!seen.has(q)) return null;
    let total = lin(0);
    let x = q;
    while (x !== p) {
      const st = prev.get(x)!;
      total = linAdd(total, elementVoltage(st.e), st.sign);
      x = st.from;
    }
    return total;
  };
  const elementVoltage = (e: NetElement): Lin => {
    if (e.type === 'R') return linScale(branch[e.id], Number(e.params.value));
    if (e.type === 'V') return lin(sourceDC(e));
    return lin(0);
  };
  const ctrlVoltage = (ref: NetElement): { sym: string; lin: Lin } | null => {
    const sym = `v_${ref.id}`;
    const l = ref.type === 'R' || ref.type === 'V' ? elementVoltage(ref) : voltageBetween(ref.nodes[0], ref.nodes[1]);
    if (!l) return null;
    if (!defined.has(sym)) {
      defined.add(sym);
      defs.push(`${sym} = ${fmtLin(l)}`);
    }
    return { sym, lin: l };
  };
  const ctrlCurrent = (ref: NetElement): { sym: string; lin: Lin } | null => {
    const sym = `i_${ref.id}`;
    let l: Lin | null = null;
    if (ref.type === 'I') l = lin(sourceDC(ref));
    else if (ref.type === 'C' || ref.type === 'VM') l = lin(0);
    else if (branch[ref.id]) l = branch[ref.id];
    if (!l) return null;
    if (!defined.has(sym)) {
      defined.add(sym);
      defs.push(`${sym} = ${fmtLin(l)}`);
    }
    return { sym, lin: l };
  };
  const ctrlOf = (e: NetElement) => {
    const ref = elById.get(e.params.ctrl?.ref ?? '');
    if (!ref) return null;
    return e.type === 'E' || e.type === 'G' ? ctrlVoltage(ref) : ctrlCurrent(ref);
  };

  // Bir çevrenin KGY terimleri (akım kaynakları hariç): Σ düşüm = 0
  const kvl = (m: Mesh, skip: Set<string>): { texts: string[]; lin: Lin; rhs: number } => {
    const texts: string[] = [];
    let total = lin(0);
    let rhs = 0;
    for (const { id, d } of m.elements) {
      if (skip.has(id)) continue;
      const e = elById.get(id)!;
      if (CURRENT_SRC.has(e.type)) continue;
      if (e.type === 'R') {
        const R = Number(e.params.value);
        const along = linScale(branch[id], d); // dolaşma yönündeki akım
        const inner = fmtLin(along, m.name);
        texts.push(`${num(R)}·${/ [+−] /.test(inner) ? `(${inner})` : inner}`);
        total = linAdd(total, linScale(along, R));
      } else if (e.type === 'V') {
        rhs -= d * sourceDC(e);
      } else if (e.type === 'E' || e.type === 'H') {
        const c = ctrlOf(e);
        if (!c) {
          unsupported = `${e.id}'in kontrol büyüklüğü çevre akımlarıyla yazılamıyor; düğüm yöntemini kullanın.`;
          continue;
        }
        const g = Number(e.params.gain ?? 0) * d;
        texts.push(`${num(g)}·${c.sym}`);
        total = linAdd(total, linScale(c.lin, g));
      }
      // AM ve DC'de bobin: gerilim düşümü 0
    }
    return { texts, lin: total, rhs };
  };

  const equations: EqLine[] = [];
  const rows: Lin[] = [];
  const given: string[] = [];

  // Akım kaynakları: hangi çevrelerde
  const csInfo = nl.elements
    .filter((e) => CURRENT_SRC.has(e.type))
    .map((e) => ({ e, meshes: meshes.filter((m) => m.elements.some((x) => x.id === e.id)).map((m) => m.name) }))
    .filter((c) => c.meshes.length > 0);
  const mParent = new Map(meshes.map((m) => [m.name, m.name]));
  const mFind = (a: string): string => (mParent.get(a) === a ? a : mFind(mParent.get(a)!));
  for (const c of csInfo) if (c.meshes.length === 2) mParent.set(mFind(c.meshes[0]), mFind(c.meshes[1]));
  const groups = new Map<string, Mesh[]>();
  for (const m of meshes) {
    const r = mFind(m.name);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(m);
  }
  const supermeshes: string[][] = [];

  // Akım kaynağı kısıtları
  for (const c of csInfo) {
    let value: Lin;
    let vtext: string;
    if (c.e.type === 'I') {
      value = lin(sourceDC(c.e));
      vtext = `${num(sourceDC(c.e))} A`;
    } else {
      const ctl = ctrlOf(c.e);
      if (!ctl) {
        unsupported = `${c.e.id}'in kontrol büyüklüğü çevre akımlarıyla yazılamıyor; düğüm yöntemini kullanın.`;
        continue;
      }
      const g = Number(c.e.params.gain ?? 0);
      value = linScale(ctl.lin, g);
      vtext = `${num(g)}·${ctl.sym}`;
    }
    const row = linAdd(branch[c.e.id], value, -1);
    rows.push(row);
    const where = c.meshes.length === 1 ? 'dış daldaki akım kaynağı' : `${c.meshes.join(' ile ')} arasındaki akım kaynağı`;
    equations.push({ title: `${c.e.id} (${where})`, text: `${fmtLin(branch[c.e.id])} = ${vtext}`, simplified: linEquation(row, unknowns) });
    if (c.meshes.length === 1 && c.e.type === 'I') {
      const coef = branch[c.e.id].c.get(c.meshes[0]) ?? 1;
      given.push(`${c.meshes[0]} = ${num(sourceDC(c.e) / coef)} A`);
    }
  }

  // KGY: süperçevreler ve normal çevreler
  for (const g of groups.values()) {
    const names = g.map((m) => m.name);
    const hasOuterCS = csInfo.some((c) => c.meshes.length === 1 && names.includes(c.meshes[0]));
    if (hasOuterCS) continue; // akımlar kısıtlarla belirli
    if (g.length > 1) supermeshes.push(names);
    // ortak elemanlar (iki üye çevrede de olan) birbirini götürür
    const count = new Map<string, number>();
    for (const m of g) for (const x of m.elements) count.set(x.id, (count.get(x.id) ?? 0) + 1);
    const shared = new Set([...count].filter(([, n]) => n > 1 && g.length > 1).map(([id]) => id));
    let total = lin(0);
    let rhs = 0;
    const texts: string[] = [];
    for (const m of g) {
      const r = kvl(m, shared);
      total = linAdd(total, r.lin);
      rhs += r.rhs;
      texts.push(...r.texts);
    }
    const row = linAdd(total, lin(-rhs));
    rows.push(row);
    equations.push({
      title: g.length > 1 ? `Süperçevre {${names.join(', ')}} (KGY)` : `Çevre ${names[0]} (KGY)`,
      text: `${joinTerms(texts)} = ${num(rhs)}`,
      simplified: linEquation(row, unknowns),
    });
  }
  if (unsupported) return fail(unsupported);
  if (rows.length !== unknowns.length)
    return fail('Akım kaynakları bir kesitleme oluşturuyor (örneğin seri akım kaynakları); çevre denklemleri tutarsız.');

  const { A, b } = linSystem(rows, unknowns);
  const solution = solveDense(A, b);
  const values: Record<string, number> = {};
  if (solution) unknowns.forEach((u, i) => (values[u] = solution[i]));
  return { ok: true, unknowns, given, defs, equations, A, b, solution, values, meshes, supermeshes, branchCurrents: branch };
}

/** Çevre akımlarından eleman akımı */
export function evalLin(l: Lin, values: Record<string, number>): number {
  let s = l.k;
  for (const [n, v] of l.c) s += v * (values[n] ?? 0);
  return s;
}
