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
  /** Akımı başka bir eleman tarafından okunan L / C elemanları */
  ctrlI: Set<string>;
  /** İsimden elemana */
  byId: Map<string, NetElement>;
  /** Bağımlı kaynak kazançlarını değiştirmek için (cebirsel döngü teşhisi) */
  gainScale?: Map<string, number>;
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
    byId: new Map(nl.elements.map((e) => [e.id, e])),
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
      case 'E':
      case 'H':
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

const gainOf = (e: NetElement, ctx: StampCtx) => Number(e.params.gain ?? 0) * (ctx.gainScale?.get(e.id) ?? 1);

/**
 * Akım kontrolünün çözümdeki karşılığı:
 * - dal akımı bilinmeyeni olan eleman (V, AM, E, H, DC'de L, akımı ölçülen L / C)
 * - direnç: i = v / R (gerilim kontrolüne çevrilir)
 * - akımı zaten bilinen eleman (I kaynağı, DC'de C = 0, voltmetre = 0)
 */
type CtrlCurrent =
  | { kind: 'branch'; id: string }
  | { kind: 'conductance'; c: number; d: number; g: number }
  | { kind: 'const'; value: Complex };

function ctrlCurrent(ref: NetElement, ctx: StampCtx, hasBranch: (id: string) => boolean): CtrlCurrent {
  if (hasBranch(ref.id)) return { kind: 'branch', id: ref.id };
  switch (ref.type) {
    case 'R':
      return { kind: 'conductance', c: ref.nodes[0], d: ref.nodes[1], g: 1 / Number(ref.params.value) };
    case 'I':
      return { kind: 'const', value: sourceValue(ref, ctx) };
    case 'L':
      if (ctx.mode === 'tran0') return { kind: 'const', value: cx(Number(ref.params.i0 ?? 0)) };
      return { kind: 'const', value: ZERO };
    default:
      // DC'de kapasitör ve voltmetre akımı 0
      return { kind: 'const', value: ZERO };
  }
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
    case 'E':
    case 'G': {
      const ref = ctx.byId.get(e.params.ctrl?.ref ?? '');
      const [c, d] = ref ? ref.nodes : [0, 0];
      const g = gainOf(e, ctx);
      if (e.type === 'E') sys.stampVCVS(a, b, c, d, id, g, id);
      else sys.stampVCCS(a, b, c, d, g, id);
      return;
    }
    case 'F':
    case 'H': {
      const ref = ctx.byId.get(e.params.ctrl?.ref ?? '');
      const g = gainOf(e, ctx);
      const cc: CtrlCurrent = ref ? ctrlCurrent(ref, ctx, (x) => sys.hasBranch(x)) : { kind: 'const', value: ZERO };
      if (e.type === 'F') {
        if (cc.kind === 'branch') sys.stampCCCS(a, b, cc.id, g, id);
        else if (cc.kind === 'conductance') sys.stampVCCS(a, b, cc.c, cc.d, g * cc.g, id);
        else sys.stampCurrent(a, b, cx(cc.value.re * g, cc.value.im * g), id);
      } else {
        if (cc.kind === 'branch') sys.stampCCVS(a, b, id, cc.id, g, id);
        else if (cc.kind === 'conductance') sys.stampVCVS(a, b, cc.c, cc.d, id, g * cc.g, id);
        else sys.stampVoltage(a, b, id, cx(cc.value.re * g, cc.value.im * g), id);
      }
      return;
    }
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
    case 'E':
    case 'H':
      return { V, I: sol.j(e.id) };
    case 'G': {
      const ref = ctx.byId.get(e.params.ctrl?.ref ?? '');
      if (!ref) return { V, I: ZERO };
      const vc = sol.v(ref.nodes[0]);
      const vd = sol.v(ref.nodes[1]);
      const g = gainOf(e, ctx);
      return { V, I: cx((vc.re - vd.re) * g, (vc.im - vd.im) * g) };
    }
    case 'F': {
      const ref = ctx.byId.get(e.params.ctrl?.ref ?? '');
      if (!ref) return { V, I: ZERO };
      const g = gainOf(e, ctx);
      const cc = ctrlCurrent(ref, ctx, sol.has);
      let i: Complex;
      if (cc.kind === 'branch') i = sol.j(cc.id);
      else if (cc.kind === 'conductance') {
        const vc = sol.v(cc.c);
        const vd = sol.v(cc.d);
        i = cx((vc.re - vd.re) * cc.g, (vc.im - vd.im) * cc.g);
      } else i = cc.value;
      return { V, I: cx(i.re * g, i.im * g) };
    }
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
