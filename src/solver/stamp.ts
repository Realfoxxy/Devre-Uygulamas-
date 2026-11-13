// Ortak damgalama: her eleman DC, AC ve geçici rejimde matrise yalnızca burada eklenir.
// Yeni bir bileşen eklemek için bu dosyadaki üç fonksiyona (dal listesi, damga, ölçüm)
// bir dal eklemek yeterlidir.
import { Complex, ZERO, cx, div, fromPolar, mul } from '../core/complex';
import type { Netlist, NetElement } from '../core/netlist';
import { MNASystem } from './mna';
import { sourceAt, sourceBefore } from './waveform';

export type StampMode = 'dc' | 'ac' | 'tran' | 'tran0';

export interface StampCtx {
  mode: StampMode;
  /** AC açısal frekansı */
  w: number;
  /** Geçici rejim: zaman, adım, trapez mi */
  t: number;
  h: number;
  trap: boolean;
  /** Geçici rejim: kapasitör / bobinlerin bir önceki adım değerleri */
  state: Map<string, { v: number; i: number }>;
  /** Bağımsız kaynakları sıfırla (gerilim kaynağı kısa, akım kaynağı açık) */
  zero?: boolean;
  /** zero ile birlikte: yalnızca bu kaynak açık kalır (süperpozisyon) */
  keep?: string;
  /** Devreden çıkarılan elemanlar (Thevenin yükü, τ hesabı) */
  exclude?: Set<string>;
  /** DC'de kapasitör kısa devre sayılsın mı (yalnız iç hesaplar) */
  /** Akımı başka bir eleman tarafından okunan L / C elemanları */
  ctrlI: Set<string>;
}

export function makeCtx(mode: StampMode, nl: Netlist, extra: Partial<StampCtx> = {}): StampCtx {
  return {
    mode,
    w: 0,
    t: 0,
    h: 1,
    trap: false,
    state: new Map(),
    ctrlI: currentControlled(nl),
    ...extra,
  };
}

/** Akımı bağımlı bir kaynak tarafından kontrol edilen elemanlar */
export function currentControlled(nl: Netlist): Set<string> {
  const s = new Set<string>();
  for (const e of nl.elements) if (e.params.ctrl?.kind === 'I' && e.params.ctrl.ref) s.add(e.params.ctrl.ref);
  return s;
}

const active = (e: NetElement, ctx: StampCtx) => !ctx.exclude?.has(e.id);

/** Bağımsız kaynağın bu bağlamdaki değeri (DC: t < 0 değeri, AC: fazör, geçici: anlık) */
export function sourceValue(e: NetElement, ctx: StampCtx): Complex {
  if (ctx.zero && ctx.keep !== e.id) return ZERO;
  const p = e.params;
  switch (ctx.mode) {
    case 'dc':
      return cx(sourceBefore(e));
    case 'ac':
      return p.mode === 'AC' ? fromPolar(Number(p.amp ?? 0), Number(p.phase ?? 0)) : ZERO;
    default:
      return cx(sourceAt(e, ctx.t));
  }
}

/** Bu bağlamda dal akımı bilinmeyeni gereken elemanlar */
export function branchIds(nl: Netlist, ctx: StampCtx): string[] {
  const out: string[] = [];
  for (const e of nl.elements) {
    if (!active(e, ctx)) continue;
    switch (e.type) {
      case 'V':
      case 'AM':
        out.push(e.id);
        break;
      case 'L':
        if (ctx.mode === 'dc' || ctx.ctrlI.has(e.id)) out.push(e.id);
        break;
      case 'C':
        if (ctx.mode === 'tran0' || (ctx.mode !== 'dc' && ctx.ctrlI.has(e.id))) out.push(e.id);
        break;
    }
  }
  return out;
}

function companion(e: NetElement, ctx: StampCtx) {
  const val = Number(e.params.value);
  const k = ctx.trap ? 2 : 1;
  const st = ctx.state.get(e.id) ?? { v: 0, i: 0 };
  if (e.type === 'C') {
    const G = (k * val) / ctx.h;
    // i = G·v − Ieq
    return { G, Ieq: ctx.trap ? G * st.v + st.i : G * st.v };
  }
  const G = ctx.h / (k * val);
  // i = G·v + Ieq
  return { G, Ieq: ctx.trap ? st.i + G * st.v : st.i };
}

export function newSystem(nl: Netlist, ctx: StampCtx, track = true): MNASystem {
  return new MNASystem(nl.nodeCount, branchIds(nl, ctx), track);
}

/** Tek bir elemanın damgası. */
export function stampElement(sys: MNASystem, e: NetElement, ctx: StampCtx) {
  if (!active(e, ctx)) return;
  const [a, b] = e.nodes;
  const id = e.id;
  const val = Number(e.params.value);
  switch (e.type) {
    case 'R':
      sys.stampAdmittance(a, b, cx(1 / val), id);
      return;
    case 'C': {
      if (ctx.mode === 'dc') return; // açık devre
      if (ctx.mode === 'tran0') {
        sys.stampVoltage(a, b, id, cx(Number(e.params.v0 ?? 0)), id);
        return;
      }
      if (ctx.mode === 'ac') {
        const y = cx(0, ctx.w * val);
        if (sys.hasBranch(id)) sys.stampBranch(a, b, id, ZERO, div(cx(1), y), id);
        else sys.stampAdmittance(a, b, y, id);
        return;
      }
      const { G, Ieq } = companion(e, ctx);
      if (sys.hasBranch(id)) sys.stampBranch(a, b, id, cx(Ieq / G), cx(1 / G), id);
      else {
        sys.stampAdmittance(a, b, cx(G), id);
        sys.stampCurrent(b, a, cx(Ieq), id);
      }
      return;
    }
    case 'L': {
      if (ctx.mode === 'dc') {
        sys.stampVoltage(a, b, id, ZERO, id); // kısa devre
        return;
      }
      if (ctx.mode === 'tran0') {
        const I = cx(Number(e.params.i0 ?? 0));
        if (sys.hasBranch(id)) sys.stampCurrentBranch(a, b, id, I, id);
        else sys.stampCurrent(a, b, I, id);
        return;
      }
      if (ctx.mode === 'ac') {
        const z = cx(0, ctx.w * val);
        if (sys.hasBranch(id)) sys.stampBranch(a, b, id, ZERO, z, id);
        else sys.stampAdmittance(a, b, div(cx(1), z), id);
        return;
      }
      const { G, Ieq } = companion(e, ctx);
      if (sys.hasBranch(id)) sys.stampBranch(a, b, id, cx(-Ieq / G), cx(1 / G), id);
      else {
        sys.stampAdmittance(a, b, cx(G), id);
        sys.stampCurrent(a, b, cx(Ieq), id);
      }
      return;
    }
    case 'V':
      sys.stampVoltage(a, b, id, sourceValue(e, ctx), id);
      return;
    case 'I':
      sys.stampCurrent(a, b, sourceValue(e, ctx), id);
      return;
    case 'AM':
      sys.stampVoltage(a, b, id, ZERO, id);
      return;
    case 'VM':
      return; // ideal voltmetre: açık devre
  }
}

export function stampAll(sys: MNASystem, nl: Netlist, ctx: StampCtx) {
  for (const e of nl.elements) stampElement(sys, e, ctx);
}

/** Çözümden okunan düğüm gerilimi / dal akımı */
export interface Solution {
  v: (node: number) => Complex;
  j: (id: string) => Complex;
  has: (id: string) => boolean;
}

export function solutionFrom(sys: MNASystem, x: { re: ArrayLike<number>; im?: ArrayLike<number> }): Solution {
  const at = (i: number) => cx(x.re[i], x.im ? x.im[i] : 0);
  return {
    v: (k) => (k <= 0 ? ZERO : at(k - 1)),
    j: (id) => at(sys.branch(id)),
    has: (id) => sys.hasBranch(id),
  };
}

/** Elemanın pasif işaret kuralıyla gerilimi (+ uçtan − uca) ve akımı (+ uçtan giren). */
export function measureElement(e: NetElement, ctx: StampCtx, sol: Solution): { V: Complex; I: Complex } {
  const [a, b] = e.nodes;
  const va = sol.v(a);
  const vb = sol.v(b);
  const V = cx(va.re - vb.re, va.im - vb.im);
  const val = Number(e.params.value);
  switch (e.type) {
    case 'R':
      return { V, I: cx(V.re / val, V.im / val) };
    case 'C':
      if (ctx.mode === 'dc') return { V, I: ZERO };
      if (sol.has(e.id)) return { V, I: sol.j(e.id) };
      if (ctx.mode === 'ac') return { V, I: mul(V, cx(0, ctx.w * val)) };
      {
        const { G, Ieq } = companion(e, ctx);
        return { V, I: cx(G * V.re - Ieq) };
      }
    case 'L':
      if (sol.has(e.id)) return { V: ctx.mode === 'dc' ? ZERO : V, I: sol.j(e.id) };
      if (ctx.mode === 'tran0') return { V, I: cx(Number(e.params.i0 ?? 0)) };
      if (ctx.mode === 'ac') return { V, I: div(V, cx(0, ctx.w * val)) };
      {
        const { G, Ieq } = companion(e, ctx);
        return { V, I: cx(G * V.re + Ieq) };
      }
    case 'V':
      return { V, I: sol.j(e.id) };
    case 'I':
      return { V, I: sourceValue(e, ctx) };
    case 'AM':
      return { V: ZERO, I: sol.j(e.id) };
    case 'VM':
      return { V, I: ZERO };
    default:
      return { V, I: ZERO };
  }
}

/** Pasif elemanların AC empedansı (sonuç panelinde gösterilir) */
export function impedanceOf(e: NetElement, w: number): Complex | undefined {
  const v = Number(e.params.value);
  if (e.type === 'R') return cx(v);
  if (e.type === 'C') return div(cx(1), cx(0, w * v));
  if (e.type === 'L') return cx(0, w * v);
  return undefined;
}
