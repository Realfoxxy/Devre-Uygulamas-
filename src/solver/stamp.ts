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
  /** Bağımsız kaynakların okunduğu an (kırılma noktasında biten adımda kenarın SOL limiti); yoksa t */
  tSrc?: number;
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
  /** Elemanların iç düğümleri (ör. sonlu kazançlı op-amp) → düğüm numarası */
  internal: Map<string, number>;
  /** İç düğümler dahil toplam düğüm sayısı */
  nodeTotal: number;
  /** Anahtar konumlarının değerlendirileceği an (verilmezse: DC → t < 0, tran0 → 0⁺, tran → t'den hemen önce) */
  swTime?: number;
  /** Karmaşık frekans s (verilirse AC damgasında jω yerine kullanılır; zorlanmış yanıt için) */
  s?: Complex;
  /** Kaynak değerini zorla (zorlanmış yanıt için birim giriş) */
  sourceOverride?: Map<string, Complex>;
}

export const R_ON = 1e-3;
export const R_OFF = 1e12;
const MIN_R = 1e-3;

/** İç düğüm gerektiren elemanlar için numara ayırır. */
function allocInternal(nl: Netlist): Map<string, number> {
  const m = new Map<string, number>();
  let k = nl.nodeCount;
  for (const e of nl.elements) {
    if (e.type === 'OA' && e.params.model === 'finite') m.set(`${e.id}#x`, ++k);
    if (e.type === 'OA' && e.params.model === 'offset') m.set(`${e.id}#p`, ++k);
  }
  return m;
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
    ...(() => {
      const internal = allocInternal(nl);
      return { internal, nodeTotal: nl.nodeCount + internal.size };
    })(),
    ...extra,
  };
}

/** Sıcaklık sensörünün akımı I = k·T (kelvin) */
export const tsCurrent = (e: NetElement) => Number(e.params.kT ?? 1e-6) * (Number(e.params.tempC ?? 25) + 273.15);
/** Potansiyometrenin iki parçası: üst (pin0–orta) ve alt (orta–pin1) */
export const potParts = (e: NetElement) => {
  const Rp = Number(e.params.value);
  const a = Math.min(1, Math.max(0, Number(e.params.pos ?? 0.5)));
  return { top: Math.max(MIN_R, (1 - a) * Rp), bottom: Math.max(MIN_R, a * Rp) };
};
/** Bu bağlamda anahtarın kaç kez konum değiştirmiş olduğu */
export function switchToggles(e: NetElement, ctx: Pick<StampCtx, 'mode' | 't' | 'swTime'>): number {
  const times = e.params.times ?? [];
  if (ctx.swTime !== undefined) return times.filter((x) => x <= ctx.swTime!).length;
  if (ctx.mode === 'dc' || ctx.mode === 'ac') return times.filter((x) => x < 0).length;
  if (ctx.mode === 'tran0') return times.filter((x) => x <= 0).length;
  // adım (t−h, t] aralığında anahtar, t'den önceki anlardaki değişimlere göre konumdadır
  return times.filter((x) => x < ctx.t - 1e-15).length;
}

/** Tek yollu anahtar kapalı mı? */
export function switchClosed(e: NetElement, ctx: Pick<StampCtx, 'mode' | 't' | 'swTime'>): boolean {
  const closed0 = (e.params.sw0 ?? 'open') === 'closed';
  return switchToggles(e, ctx) % 2 === 0 ? closed0 : !closed0;
}

/** İki yollu anahtarın ortak–A ve ortak–B dirençleri (t anında) */
export function sw2Way(e: NetElement, ctx: Pick<StampCtx, 'mode' | 't' | 'swTime'>): 'A' | 'B' {
  const w0 = e.params.way ?? 'A';
  return switchToggles(e, ctx) % 2 === 0 ? w0 : w0 === 'A' ? 'B' : 'A';
}
export function sw2Parts(e: NetElement, ctx: StampCtx) {
  const onA = sw2Way(e, ctx) === 'A';
  return { rA: onA ? R_ON : R_OFF, rB: onA ? R_OFF : R_ON };
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
  const o = ctx.sourceOverride?.get(e.id);
  if (o) return o;
  if (ctx.zero && ctx.keep !== e.id) return ZERO;
  const p = e.params;
  switch (ctx.mode) {
    case 'dc':
      return cx(sourceBefore(e));
    case 'ac':
      return p.mode === 'AC' ? fromPolar(Number(p.amp ?? 0), Number(p.phase ?? 0)) : ZERO;
    default:
      return cx(sourceAt(e, ctx.tSrc ?? ctx.t));
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
      case 'OA':
        out.push(e.id);
        if (e.params.model === 'offset') out.push(`${e.id}#os`);
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

export function newSystem(nl: Netlist, ctx: StampCtx, track = true, extraBranches: string[] = []): MNASystem {
  const labels: Record<number, string> = {};
  for (const [k, n] of ctx.internal) labels[n] = `v(${k.replace('#x', '·iç').replace('#p', '·+iç')})`;
  return new MNASystem(ctx.nodeTotal, [...branchIds(nl, ctx), ...extraBranches], track, labels);
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
        const y = ctx.s ? cx(ctx.s.re * val, ctx.s.im * val) : cx(0, ctx.w * val);
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
        const z = ctx.s ? cx(ctx.s.re * val, ctx.s.im * val) : cx(0, ctx.w * val);
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
    case 'TS':
      sys.stampCurrent(a, b, ctx.zero && ctx.keep !== id ? ZERO : cx(tsCurrent(e)), id);
      return;
    case 'AM':
      // gerçek ampermetre: seri iç direnç
      sys.stampBranch(a, b, id, ZERO, e.params.real ? cx(Number(e.params.rMeter ?? 1)) : ZERO, id);
      return;
    case 'VM':
      if (e.params.real) sys.stampAdmittance(a, b, cx(1 / Number(e.params.rMeter ?? 10e6)), id);
      return; // ideal voltmetre: açık devre
    case 'POT': {
      const w = e.nodes[2];
      const { top, bottom } = potParts(e);
      sys.stampAdmittance(a, w, cx(1 / top), id);
      sys.stampAdmittance(w, b, cx(1 / bottom), id);
      return;
    }
    case 'SW2': {
      const [c, pa, pb] = e.nodes;
      const { rA, rB } = sw2Parts(e, ctx);
      sys.stampAdmittance(c, pa, cx(1 / rA), id);
      sys.stampAdmittance(c, pb, cx(1 / rB), id);
      return;
    }
    case 'SW':
      sys.stampAdmittance(a, b, cx(1 / (switchClosed(e, ctx) ? R_ON : R_OFF)), id);
      return;
    case 'OA': {
      const [p, n, o] = e.nodes;
      const model = e.params.model ?? 'ideal';
      if (model === 'finite') {
        // girişler arasında R_i, içeride A·(v+ − v−) değerinde VCVS, çıkışta seri R_o
        const x = ctx.internal.get(`${id}#x`)!;
        sys.stampAdmittance(p, n, cx(1 / Number(e.params.rin ?? 1e6)), id);
        sys.stampVCVS(x, 0, p, n, id, Number(e.params.gainA ?? 1e5), id);
        sys.stampAdmittance(x, o, cx(1 / Number(e.params.rout ?? 100)), id);
        return;
      }
      if (model === 'offset') {
        // + girişe seri V_os, iki girişte öngerilim akımı I_b; çekirdek ideal (AC'de ve sıfırlanan kaynaklarda 0)
        const pp = ctx.internal.get(`${id}#p`)!;
        const on = ctx.mode !== 'ac' && !(ctx.zero && ctx.keep !== id);
        sys.stampVoltage(pp, p, `${id}#os`, on ? cx(Number(e.params.vos ?? 5e-3)) : ZERO, id);
        const Ib = on ? Number(e.params.ib ?? 500e-9) : 0;
        sys.stampCurrent(p, 0, cx(Ib), id);
        sys.stampCurrent(n, 0, cx(Ib), id);
        sys.stampIdealOpAmp(o, pp, n, id, id);
        return;
      }
      sys.stampIdealOpAmp(o, p, n, id, id);
      return;
    }
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
export interface Measure {
  V: Complex;
  I: Complex;
  /** Üç uçlu elemanlarda pin gerilimleri ve her pinden giren akım */
  pinV?: Complex[];
  pinI?: Complex[];
}

export function measureElement(e: NetElement, ctx: StampCtx, sol: Solution): Measure {
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
      if (ctx.mode === 'ac') return { V, I: mul(V, ctx.s ? cx(ctx.s.re * val, ctx.s.im * val) : cx(0, ctx.w * val)) };
      {
        const { G, Ieq } = companion(e, ctx);
        return { V, I: cx(G * V.re - Ieq) };
      }
    case 'L':
      if (sol.has(e.id)) return { V: ctx.mode === 'dc' ? ZERO : V, I: sol.j(e.id) };
      if (ctx.mode === 'tran0') return { V, I: cx(Number(e.params.i0 ?? 0)) };
      if (ctx.mode === 'ac') return { V, I: div(V, ctx.s ? cx(ctx.s.re * val, ctx.s.im * val) : cx(0, ctx.w * val)) };
      {
        const { G, Ieq } = companion(e, ctx);
        return { V, I: cx(G * V.re + Ieq) };
      }
    case 'V':
      return { V, I: sol.j(e.id) };
    case 'I':
      return { V, I: sourceValue(e, ctx) };
    case 'AM':
      return { V: e.params.real ? V : ZERO, I: sol.j(e.id) };
    case 'VM':
      return { V, I: e.params.real ? cx(V.re / Number(e.params.rMeter ?? 10e6), V.im / Number(e.params.rMeter ?? 10e6)) : ZERO };
    case 'TS':
      return { V, I: ctx.zero && ctx.keep !== e.id ? ZERO : cx(tsCurrent(e)) };
    case 'SW': {
      const r = switchClosed(e, ctx) ? R_ON : R_OFF;
      return { V, I: cx(V.re / r, V.im / r) };
    }
    case 'POT': {
      const vw = sol.v(e.nodes[2]);
      const { top, bottom } = potParts(e);
      const iTop = cx((va.re - vw.re) / top, (va.im - vw.im) / top);
      const iBot = cx((vw.re - vb.re) / bottom, (vw.im - vb.im) / bottom);
      // her pinden giren akım: a ucu, b ucu, orta uç (orta uçtan akım çekilince iTop ≠ iBot)
      return { V, I: iTop, pinV: [va, vb, vw], pinI: [iTop, cx(-iBot.re, -iBot.im), cx(iBot.re - iTop.re, iBot.im - iTop.im)] };
    }
    case 'SW2': {
      const [c, pa, pb] = e.nodes.map((k) => sol.v(k));
      const { rA, rB } = sw2Parts(e, ctx);
      const iA = cx((c.re - pa.re) / rA, (c.im - pa.im) / rA);
      const iB = cx((c.re - pb.re) / rB, (c.im - pb.im) / rB);
      const onA = sw2Way(e, ctx) === 'A';
      return { V: onA ? cx(c.re - pa.re, c.im - pa.im) : cx(c.re - pb.re, c.im - pb.im), I: onA ? iA : iB, pinV: [c, pa, pb], pinI: [cx(iA.re + iB.re, iA.im + iB.im), cx(-iA.re, -iA.im), cx(-iB.re, -iB.im)] };
    }
    case 'OA': {
      const [vp, vn, vo] = e.nodes.map((k) => sol.v(k));
      let iout: Complex;
      if ((e.params.model ?? 'ideal') === 'finite') {
        const vx = sol.v(ctx.internal.get(`${e.id}#x`)!);
        const ro = Number(e.params.rout ?? 100);
        iout = cx((vx.re - vo.re) / ro, (vx.im - vo.im) / ro);
      } else {
        const j = sol.j(e.id); // j: o düğümünden op-amp'a giren akım
        iout = cx(-j.re, -j.im);
      }
      const model = e.params.model ?? 'ideal';
      const rin = Number(e.params.rin ?? 1e6);
      const iin = model === 'finite' ? cx((vp.re - vn.re) / rin, (vp.im - vn.im) / rin) : ZERO;
      const ib = model === 'offset' && ctx.mode !== 'ac' && !(ctx.zero && ctx.keep !== e.id) ? cx(Number(e.params.ib ?? 500e-9)) : ZERO;
      return {
        V: vo,
        I: iout,
        pinV: [vp, vn, vo],
        pinI: [model === 'offset' ? ib : iin, model === 'offset' ? ib : cx(-iin.re, -iin.im), cx(-iout.re, -iout.im)],
      };
    }
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
