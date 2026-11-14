// Devre teoremleri (Bölüm 5): kaynak dönüşümü, süperpozisyon, Thevenin / Norton,
// eşdeğer direnç ve maksimum güç aktarımı. DC'de ve AC'de (tek frekans, fazörle) çalışır.
import { Complex, ZERO, abs, cx, div, sub } from '../../core/complex';
import type { Netlist, NetElement } from '../../core/netlist';
import { SingularMatrixError } from '../lu';
import { MNASystem } from '../mna';
import { StampCtx, makeCtx, measureElement, newSystem, solutionFrom, stampAll } from '../stamp';
import { sourceBefore } from '../waveform';

export type TheoremMode = { kind: 'dc' } | { kind: 'ac'; freq: number };

const isIndependent = (e: NetElement, mode?: TheoremMode) =>
  e.type === 'V' || e.type === 'I' || (mode?.kind !== 'ac' && (e.type === 'TS' || (e.type === 'OA' && e.params.model === 'offset')));

function ctxFor(nl: Netlist, mode: TheoremMode, extra: Partial<StampCtx> = {}) {
  return makeCtx(mode.kind === 'dc' ? 'dc' : 'ac', nl, { w: mode.kind === 'ac' ? 2 * Math.PI * mode.freq : 0, ...extra });
}

interface Solved {
  v: (n: number) => Complex;
  j: (id: string) => Complex;
  sys: MNASystem;
  x: { re: Float64Array; im: Float64Array };
}

/** Devreyi isteğe bağlı ek damgalarla çözer; tekilse null. */
function solve(nl: Netlist, ctx: StampCtx, extraBranches: string[] = [], extra?: (sys: MNASystem) => void, gmin = 0): Solved | null {
  const sys = newSystem(nl, ctx, false, extraBranches);
  if (gmin) for (let k = 1; k <= nl.nodeCount; k++) sys.stampAdmittance(k, 0, cx(gmin));
  stampAll(sys, nl, ctx);
  extra?.(sys);
  try {
    const x = ctx.mode === 'ac' ? sys.solveComplex() : { re: sys.solveReal(), im: new Float64Array(sys.N) };
    const sol = solutionFrom(sys, x);
    return { v: sol.v, j: sol.j, sys, x };
  } catch (e) {
    if (e instanceof SingularMatrixError) return null;
    throw e;
  }
}

/* ───────────────────────────── Süperpozisyon ───────────────────────────── */

export interface SuperRow {
  /** Açık kalan kaynak (null: tüm kaynaklar, tam çözüm) */
  source: string | null;
  V: Complex;
  I: Complex;
  P: number;
  zeroed: string[];
}

export interface SuperResult {
  target: string;
  rows: SuperRow[];
  sumV: Complex;
  sumI: Complex;
  full: SuperRow;
  /** Katkıların güçleri toplamı (tam güce eşit değildir) */
  sumP: number;
}

const power = (V: Complex, I: Complex, mode: TheoremMode) => (mode.kind === 'dc' ? V.re * I.re : (V.re * I.re + V.im * I.im) / 2);

export function superposition(nl: Netlist, target: string, mode: TheoremMode): SuperResult | { error: string } {
  const el = nl.elements.find((e) => e.id === target);
  if (!el) return { error: 'Bileşen bulunamadı.' };
  const sources = nl.elements.filter((e) => isIndependent(e, mode));
  if (sources.length < 1) return { error: 'Devrede bağımsız kaynak yok.' };
  const measure = (ctx: StampCtx): { V: Complex; I: Complex } | null => {
    const s = solve(nl, ctx);
    if (!s) return null;
    return measureElement(el, ctx, { v: s.v, j: s.j, has: (id) => s.sys.hasBranch(id) });
  };
  const rows: SuperRow[] = [];
  for (const src of sources) {
    const m = measure(ctxFor(nl, mode, { zero: true, keep: src.id }));
    if (!m) return { error: `${src.id} tek başınayken devre çözülemiyor (diğer kaynaklar sıfırlanınca tekil matris).` };
    rows.push({ source: src.id, V: m.V, I: m.I, P: power(m.V, m.I, mode), zeroed: sources.filter((s) => s.id !== src.id).map((s) => s.id) });
  }
  const f = measure(ctxFor(nl, mode));
  if (!f) return { error: 'Devre çözülemiyor.' };
  const full: SuperRow = { source: null, V: f.V, I: f.I, P: power(f.V, f.I, mode), zeroed: [] };
  const sumV = rows.reduce((a, r) => cx(a.re + r.V.re, a.im + r.V.im), ZERO);
  const sumI = rows.reduce((a, r) => cx(a.re + r.I.re, a.im + r.I.im), ZERO);
  return { target, rows, sumV, sumI, full, sumP: rows.reduce((a, r) => a + r.P, 0) };
}

/* ───────────────────────────── Thevenin / Norton ───────────────────────────── */

export interface TheveninResult {
  a: number;
  b: number;
  load: string | null;
  mode: TheoremMode;
  /** null: tanımsız (açık devre çözümü tekil) */
  Vth: Complex | null;
  /** null: tanımsız (kısa devre çözümü tekil) */
  IN: Complex | null;
  /** null: sonsuz */
  Zth: Complex | null;
  /** Yalnızca eşdeğer direnç (kaynaksız ağ) */
  resistiveOnly: boolean;
  onlyDependent: boolean;
  notes: string[];
  /** R_th = V_th / I_N tutarlılık kontrolü (her ikisi tanımlıysa) */
  consistent: boolean | null;
}

const BIG = 1e11;

export function thevenin(nl: Netlist, a: number, b: number, mode: TheoremMode, load: string | null = null): TheveninResult {
  const exclude = new Set(load ? [load] : []);
  const notes: string[] = [];
  const hasIndep = nl.elements.some((e) => isIndependent(e, mode) && !exclude.has(e.id));
  const hasDep = nl.elements.some((e) => ['E', 'F', 'G', 'H'].includes(e.type) && !exclude.has(e.id));
  const vab = (s: Solved) => sub(s.v(a), s.v(b));

  // R_th: bağımsız kaynaklar sıfır, bağımlılar kalır; a'ya 1 A test akımı
  let Zth: Complex | null = null;
  const t = solve(nl, ctxFor(nl, mode, { zero: true, exclude }), [], (sys) => sys.stampCurrent(b, a, cx(1)));
  if (t) Zth = vab(t);
  else {
    // a–b açık kalıyorsa (yalnızca akım kaynağı gibi) çok küçük iletkenlikle sınır alınır
    const tg = solve(nl, ctxFor(nl, mode, { zero: true, exclude }), [], (sys) => sys.stampCurrent(b, a, cx(1)), 1e-12);
    Zth = tg ? vab(tg) : null;
  }
  if (Zth && abs(Zth) > BIG) Zth = null;

  // V_th: açık devre gerilimi
  let Vth: Complex | null = null;
  const o = solve(nl, ctxFor(nl, mode, { exclude }));
  if (o) Vth = vab(o);

  // I_N: a–b kısa devre (0 V'luk ölçüm dalı), akım a'dan b'ye
  let IN: Complex | null = null;
  const sc = solve(nl, ctxFor(nl, mode, { exclude }), ['__kisa'], (sys) => sys.stampVoltage(a, b, '__kisa', ZERO));
  if (sc) IN = sc.j('__kisa');

  const z0 = Zth !== null && abs(Zth) < 1e-9;
  if (z0) {
    IN = null;
    notes.push('Eşdeğer direnç 0 Ω (a–b arasında ideal gerilim kaynağı yolu var); kısa devre akımı sonsuz olacağından yalnızca Thevenin eşdeğeri var, Norton yok.');
  }
  if (Zth === null) {
    Vth = null;
    notes.push('Eşdeğer direnç sonsuz (a–b arasında yalnızca ideal akım kaynağı ya da açık devre var); yalnızca Norton eşdeğeri var, Thevenin yok.');
    if (!IN && o === null) notes.push('a–b açık devre bırakılınca devre çözülemiyor.');
  }
  if (Zth && Zth.re < -1e-12 && mode.kind === 'dc') notes.push('Negatif eşdeğer direnç: bu uçlar güç verebilir (bağımlı kaynak etkisi).');
  if (!hasIndep && hasDep) notes.push('Devrede yalnızca bağımlı kaynak var: V_th = 0 ve I_N = 0; R_th yalnızca test kaynağı yöntemiyle bulundu.');
  if (!hasIndep && !hasDep) notes.push('Kaynaksız ağ: sonuç a–b arasındaki eşdeğer dirençtir.');

  let consistent: boolean | null = null;
  if (Vth && IN && Zth && abs(IN) > 1e-12) {
    const r = div(Vth, IN);
    consistent = abs(sub(r, Zth)) <= 1e-6 * Math.max(1, abs(Zth));
  }
  return { a, b, load, mode, Vth, IN, Zth, resistiveOnly: !hasIndep && !hasDep, onlyDependent: !hasIndep && hasDep, notes, consistent };
}

/* ───────────────────────────── Maksimum güç ───────────────────────────── */

export interface MaxPowerResult {
  ok: boolean;
  message?: string;
  /** DC: R_L = R_th; AC: Z_L = Z_th* */
  ZL?: Complex;
  Pmax?: number;
  /** DC tarama: R_L ve P_L */
  sweep?: { R: number[]; P: number[] };
  note?: string;
}

export function maxPower(th: TheveninResult): MaxPowerResult {
  if (!th.Vth || !th.Zth) return { ok: false, message: 'Maksimum güç için Thevenin eşdeğeri gerekir.' };
  const R = th.Zth.re;
  if (!(R > 1e-12)) return { ok: false, message: 'R_th ≤ 0 olduğundan pasif bir yük için sonlu bir maksimum güç noktası yok.' };
  const V = abs(th.Vth);
  if (th.mode.kind === 'ac') {
    // fazörler tepe değerdir: P = |V|²/(8R); etkin değerle |V_rms|²/(4R)
    return {
      ok: true,
      ZL: cx(R, -th.Zth.im),
      Pmax: (V * V) / (8 * R),
      note: 'Koşul Z_L = Z_th* (karmaşık eşlenik). Fazörler tepe değer olduğu için P_max = |V_th|²/(8·R_th) (etkin değerle |V_th,rms|²/(4·R_th)).',
    };
  }
  const Rs: number[] = [];
  const Ps: number[] = [];
  const n = 61;
  for (let i = 0; i < n; i++) {
    const RL = R * Math.pow(10, -1 + (2 * i) / (n - 1));
    Rs.push(RL);
    Ps.push((V * V * RL) / ((R + RL) * (R + RL)));
  }
  return { ok: true, ZL: cx(R), Pmax: (V * V) / (4 * R), sweep: { R: Rs, P: Ps }, note: 'R_L = R_th, P_max = V_th²/(4·R_th)' };
}

/* ───────────────────────────── Kaynak dönüşümü ───────────────────────────── */

export interface SourceTransform {
  ok: boolean;
  message?: string;
  /** 'VtoI': gerilim kaynağı + seri R → akım kaynağı ∥ R; 'ItoV' tersi */
  kind?: 'VtoI' | 'ItoV';
  source?: string;
  resistor?: string;
  /** Dış uç düğümleri (a: dönüşüm sonrası kaynağın + / akım çıkış ucu) */
  a?: number;
  b?: number;
  value?: number;
  R?: number;
  /** Dönüşüm sonrası netlist */
  netlist?: Netlist;
  text?: string;
}

const degree = (nl: Netlist, n: number) => nl.elements.filter((e) => e.nodes.includes(n)).length;

/** Kullanılmayan düğümleri atıp yeniden numaralar. */
function compact(nl: Netlist, elements: NetElement[]): Netlist {
  const used = new Set<number>([0]);
  for (const e of elements) e.nodes.forEach((n) => used.add(n));
  const map = new Map<number, number>([[0, 0]]);
  let k = 1;
  for (let i = 1; i <= nl.nodeCount; i++) if (used.has(i)) map.set(i, k++);
  return {
    ...nl,
    elements: elements.map((e) => ({ ...e, nodes: e.nodes.map((n) => map.get(n)!) })),
    nodeCount: k - 1,
    issues: [],
  };
}

export interface SourceTransformOptions {
  /** Birden fazla aday direnç varsa kullanılacak olan */
  resistor?: string;
}

/** Dönüşümde kullanılabilecek dirençler (seçim için) */
export function transformCandidates(nl: Netlist, id: string): string[] {
  const src = nl.elements.find((e) => e.id === id);
  if (!src) return [];
  if (src.type === 'I')
    return nl.elements.filter((e) => e.type === 'R' && [...e.nodes].sort().join() === [...src.nodes].sort().join()).map((e) => e.id);
  const out: string[] = [];
  for (const m of src.nodes) {
    if (degree(nl, m) !== 2) continue;
    const r = nl.elements.find((e) => e.type === 'R' && (e.nodes[0] === m || e.nodes[1] === m));
    if (r) out.push(r.id);
  }
  return out;
}

export function sourceTransform(nl: Netlist, id: string, opt: SourceTransformOptions = {}): SourceTransform {
  const src = nl.elements.find((e) => e.id === id);
  if (!src || (src.type !== 'V' && src.type !== 'I')) return { ok: false, message: 'Bir gerilim ya da akım kaynağı seçin.' };
  if (src.params.mode === 'AC') return { ok: false, message: 'Kaynak dönüşümü şimdilik DC kaynaklar için.' };
  const isControlled = (eid: string) => nl.elements.some((e) => e.params.ctrl?.ref === eid);
  if (isControlled(id)) return { ok: false, message: `${id} bir bağımlı kaynağın kontrol elemanı olduğu için dönüştürülemez.` };
  const val = sourceBefore(src);
  if (src.type === 'V') {
    // + ya da − ucunda, yalnızca bu kaynağa ve bir dirence bağlı ara düğüm
    for (const pin of [0, 1] as const) {
      const m = src.nodes[pin];
      if (degree(nl, m) !== 2) continue;
      const r = nl.elements.find((e) => e.type === 'R' && e.id !== id && (e.nodes[0] === m || e.nodes[1] === m));
      if (!r || (opt.resistor && r.id !== opt.resistor)) continue;
      if (isControlled(r.id)) return { ok: false, message: `${r.id} bir bağımlı kaynağın kontrol elemanı olduğu için dönüştürülemez.` };
      const R = Number(r.params.value);
      const outerV = src.nodes[1 - pin];
      const outerR = r.nodes[0] === m ? r.nodes[1] : r.nodes[0];
      if (outerV === outerR) return { ok: false, message: 'Devrede başka dal yok; dönüşüm sonrası uçlar kısa devre olur.' };
      // V'nin + ucu dışarıdaysa (pin 1 ara düğümde) v_ab = +V, a = dış + taraf
      const plusOuter = pin === 1;
      let a = plusOuter ? outerV : outerR;
      let b = plusOuter ? outerR : outerV;
      const I = val / R;
      // akım kaynağı içinde b'den a'ya akar → eleman düğümleri [b, a]
      let elements = nl.elements
        .filter((e) => e.id !== id && e.id !== r.id)
        .concat([
          { id: `${id}`, type: 'I', nodes: [b, a], params: { mode: 'DC', value: I } },
          { id: r.id, type: 'R', nodes: [a, b], params: { value: R } },
        ]);
      if (m === 0) {
        const newGnd = b;
        elements = elements.map((e) => ({ ...e, nodes: e.nodes.map((n) => (n === newGnd ? 0 : n)) }));
        if (a === newGnd) a = 0;
        b = 0;
      }
      return {
        ok: true,
        kind: 'VtoI',
        source: id,
        resistor: r.id,
        a,
        b,
        value: I,
        R,
        netlist: compact(nl, elements),
        text: `v_s + seri R ↔ i_s ∥ R: i_s = v_s / R = ${val} / ${R} = ${parseFloat(I.toPrecision(6))} A, R = ${R} Ω (paralel)`,
      };
    }
    return { ok: false, message: `${id} ile seri bağlı bir direnç bulunamadı (ara düğümde başka dal olmamalı).` };
  }
  // akım kaynağı ∥ R
  const cands = transformCandidates(nl, id);
  if (!cands.length) return { ok: false, message: `${id} ile paralel bağlı bir direnç bulunamadı.` };
  if (cands.length > 1 && !opt.resistor)
    return { ok: false, message: `${id} ile paralel birden fazla direnç var (${cands.join(', ')}); hangisinin dönüşüme gireceğini seçin.` };
  const r = nl.elements.find((e) => e.id === (opt.resistor ?? cands[0]))!;
  if (isControlled(r.id)) return { ok: false, message: `${r.id} bir bağımlı kaynağın kontrol elemanı olduğu için dönüştürülemez.` };
  const R = Number(r.params.value);
  // akım içeride nodes[0] → nodes[1] akar, yani nodes[1] ucundan dışarı çıkar: o uç gerilim kaynağının + ucu
  const a = src.nodes[1];
  const b = src.nodes[0];
  const V = val * R;
  const mid = nl.nodeCount + 1;
  const elements = nl.elements
    .filter((e) => e.id !== id && e.id !== r.id)
    .concat([
      { id, type: 'V', nodes: [mid, b], params: { mode: 'DC', value: V } },
      { id: r.id, type: 'R', nodes: [mid, a], params: { value: R } },
    ]);
  return {
    ok: true,
    kind: 'ItoV',
    source: id,
    resistor: r.id,
    a,
    b,
    value: V,
    R,
    netlist: compact({ ...nl, nodeCount: mid }, elements),
    text: `i_s ∥ R ↔ v_s + seri R: v_s = i_s · R = ${val} · ${R} = ${parseFloat(V.toPrecision(6))} V, R = ${R} Ω (seri)`,
  };
}

/** Bir elemanın DC gerilim / akımı (dönüşüm öncesi / sonrası karşılaştırması için) */
export function dcValues(nl: Netlist): Record<string, { V: number; I: number }> | null {
  const ctx = makeCtx('dc', nl);
  const s = solve(nl, ctx);
  if (!s) return null;
  const out: Record<string, { V: number; I: number }> = {};
  for (const e of nl.elements) {
    const m = measureElement(e, ctx, { v: s.v, j: s.j, has: (id) => s.sys.hasBranch(id) });
    out[e.id] = { V: m.V.re, I: m.I.re };
  }
  return out;
}

