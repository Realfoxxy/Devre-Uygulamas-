// Geçici rejim analizi (companion model). Her adımda kapasitör ve bobin,
// bir önceki adımın değerine bağlı bir iletkenlik + paralel akım kaynağına dönüşür
// ve devre DC gibi çözülür. Geri Euler (kararlı) ya da trapez yöntemi.
import { cx } from '../core/complex';
import type { AnalysisSettings } from '../core/circuit';
import type { Netlist } from '../core/netlist';
import type { TranResult } from '../core/results';
import { luFactor, luSolve, LUReal, SingularMatrixError } from './lu';
import { MNASystem } from './mna';
import { makeCtx, measureElement, newSystem, solutionFrom, stampAll, StampCtx } from './stamp';
import { breakpoints, sourceAt, waveTimes } from './waveform';
import { switchClosed, switchToggles, sw2Way } from './stamp';

export { sourceAt } from './waveform';

/**
 * Başlangıç koşulları (Bölüm 7.8): 'auto' modda anahtarların t < 0 konumuyla DC çözüm
 * (C açık, L kısa) → v_C(0⁻), i_L(0⁻); süreklilik: v_C(0⁺) = v_C(0⁻), i_L(0⁺) = i_L(0⁻).
 * Devrede anahtar varsa varsayılan 'auto', yoksa 'manual' (elemanın v0 / i0 değeri).
 */
export function initialConditions(nl: Netlist, info: string[] = []) {
  const hasSwitch = nl.elements.some((e) => e.type === 'SW' || e.type === 'SW2');
  const v0 = new Map<string, number>();
  const i0 = new Map<string, number>();
  const autoIds = nl.elements.filter((e) => (e.type === 'C' || e.type === 'L') && (e.params.init ?? (hasSwitch ? 'auto' : 'manual')) === 'auto');
  for (const e of nl.elements) {
    if (e.type === 'C') v0.set(e.id, Number(e.params.v0 ?? 0));
    if (e.type === 'L') i0.set(e.id, Number(e.params.i0 ?? 0));
  }
  let before: Record<string, { V: number; I: number }> | undefined;
  if (autoIds.length || hasSwitch) {
    const ctx = makeCtx('dc', nl);
    let sys = newSystem(nl, ctx, false);
    stampAll(sys, nl, ctx);
    let x: Float64Array | null = null;
    try {
      x = sys.solveReal();
    } catch {
      // t < 0'da boşta kalan düğümler: çok küçük iletkenlikle 0 V'a çekilir
      sys = newSystem(nl, ctx, false);
      for (let k = 1; k <= ctx.nodeTotal; k++) sys.stampAdmittance(k, 0, cx(1e-12));
      stampAll(sys, nl, ctx);
      try {
        x = sys.solveReal();
      } catch {
        x = null;
      }
    }
    if (x) {
      const sol = solutionFrom(sys, { re: x });
      before = {};
      for (const e of nl.elements) {
        const m = measureElement(e, ctx, sol);
        before[e.id] = { V: m.V.re, I: m.I.re };
      }
      for (const e of autoIds) {
        if (e.type === 'C') v0.set(e.id, before[e.id].V);
        else i0.set(e.id, before[e.id].I);
      }
      // t < 0'da yalnızca açık anahtar ve kapasitör üzerinden bağlı düğümler
      const floating = floatingBefore(nl, ctx);
      for (const e of autoIds) {
        if (e.type !== 'C' || !e.nodes.some((k) => floating.has(k))) continue;
        v0.set(e.id, 0);
        info.push(`t < 0'da ${e.id}'in bağlı olduğu düğüm boşta (yalnızca açık anahtar ve kapasitör üzerinden bağlı); v_C(0⁻) = 0 kabul edildi.`);
      }
    }
  }
  return { v0, i0, before, hasSwitch };
}

function floatingBefore(nl: Netlist, ctx: StampCtx): Set<number> {
  const adj: number[][] = Array.from({ length: nl.nodeCount + 1 }, () => []);
  const link = (a: number, b: number) => {
    adj[a].push(b);
    adj[b].push(a);
  };
  for (const e of nl.elements) {
    if (e.type === 'C' || e.type === 'I' || e.type === 'G' || e.type === 'F' || e.type === 'TS' || (e.type === 'VM' && !e.params.real)) continue;
    if (e.type === 'SW') {
      if (switchClosed(e, ctx)) link(e.nodes[0], e.nodes[1]);
      continue;
    }
    if (e.type === 'SW2') {
      link(e.nodes[0], sw2Way(e, ctx) === 'A' ? e.nodes[1] : e.nodes[2]);
      continue;
    }
    if (e.type === 'OA') link(e.nodes[2], 0);
    else if (e.type === 'POT') {
      link(e.nodes[0], e.nodes[2]);
      link(e.nodes[2], e.nodes[1]);
    } else link(e.nodes[0], e.nodes[1]);
  }
  const seen = new Set([0]);
  const st = [0];
  while (st.length) {
    const u = st.pop()!;
    for (const v of adj[u])
      if (!seen.has(v)) {
        seen.add(v);
        st.push(v);
      }
  }
  const out = new Set<number>();
  for (let k = 1; k <= nl.nodeCount; k++) if (!seen.has(k)) out.add(k);
  return out;
}

export const MAX_STEPS = 20000;

/**
 * Her kapasitör / bobinin gördüğü Thevenin direncinden zaman sabiti:
 * bağımsız kaynaklar sıfırlanır (bağımlılar kalır), eleman çıkarılıp uçlarına
 * 1 A test akımı verilir. Birinci dereceden RC / RL devrelerinde tam sonuç verir.
 */
export function computeTaus(nl: Netlist, swTime?: number): Record<string, number> {
  const taus: Record<string, number> = {};
  for (const x of nl.elements) {
    if (x.type !== 'C' && x.type !== 'L') continue;
    const r = theveninResistance(nl, x.nodes[0], x.nodes[1], new Set([x.id]), swTime);
    if (r === null || !(r > 1e-9) || r > 1e9) continue;
    const val = Number(x.params.value);
    taus[x.id] = x.type === 'C' ? r * val : val / r;
  }
  return taus;
}

/** a–b uçlarından görülen direnç (DC, bağımsız kaynaklar sıfır, bağımlılar kalır). Tanımsızsa null. */
export function theveninResistance(nl: Netlist, a: number, b: number, exclude: Set<string>, swTime?: number): number | null {
  if (a === b) return null;
  const GMIN = 1e-12;
  const ctx = makeCtx('dc', nl, { zero: true, exclude, swTime });
  const sys = newSystem(nl, ctx, false);
  for (let k = 1; k <= nl.nodeCount; k++) sys.stampAdmittance(k, 0, cx(GMIN));
  stampAll(sys, nl, ctx);
  sys.stampCurrent(b, a, cx(1)); // 1 A, a düğümüne girer
  try {
    const v = sys.solveReal();
    const va = a > 0 ? v[a - 1] : 0;
    const vb = b > 0 ? v[b - 1] : 0;
    return va - vb;
  } catch (err) {
    if (err instanceof SingularMatrixError) return null;
    throw err;
  }
}

export interface TranTiming {
  h: number;
  tStop: number;
  /** Zaman noktaları (kırılma noktalarına hizalı) */
  grid: Float64Array;
  /** Kırılma noktasına denk gelen adım indeksleri (sonraki adım geri Euler) */
  breaks: Set<number>;
  info: string[];
}

export function resolveTiming(nl: Netlist, s: AnalysisSettings, taus: Record<string, number>): TranTiming {
  const info: string[] = [];
  const tv = Object.values(taus).filter((x) => x > 0);
  const sources = nl.elements.filter((e) => e.type === 'V' || e.type === 'I');
  const times = sources.map((e) => waveTimes(e.params));
  const minTau = tv.length ? Math.min(...tv) : Infinity;
  const maxTau = tv.length ? Math.max(...tv) : 0;
  const minScale = Math.min(...times.map((x) => x.minScale), Infinity);
  const lastEvent = Math.max(0, ...times.map((x) => x.end));

  let tStop = s.tStop && s.tStop > 0 ? s.tStop : 0;
  if (!tStop) {
    tStop = Math.max(lastEvent + 5 * maxTau, 5 * maxTau, lastEvent);
    if (!tStop) tStop = 10e-3;
    info.push(`Toplam süre otomatik: ${tStop.toPrecision(3)} s (${maxTau ? '5τ' : 'kaynak dalga biçimine göre'}).`);
  }
  let h = s.h && s.h > 0 ? s.h : 0;
  if (!h) {
    h = Math.min(minTau / 50, minScale / 50, tStop / 200);
    info.push(`Zaman adımı otomatik: h = ${h.toPrecision(3)} s (en küçük τ, darbe genişliği ya da periyodun 1/50'si).`);
  }
  const swTimes = nl.elements.filter((e) => e.type === 'SW' || e.type === 'SW2').flatMap((e) => (e.params.times ?? []).filter((x) => x > 0 && x < tStop));
  const bps = [...new Set([...sources.flatMap((e) => breakpoints(e.params, tStop)), ...swTimes].map((t) => +t.toPrecision(12)))].sort((x, y) => x - y);
  const build = (hh: number) => {
    const g: number[] = [0];
    const br = new Set<number>();
    let prev = 0;
    for (const next of [...bps, tStop]) {
      if (next <= prev + 1e-15) continue;
      const n = Math.max(1, Math.ceil((next - prev) / hh - 1e-9));
      const dt = (next - prev) / n;
      // Kenardan sonraki ilk adım geri Euler'dir (yerel hatası ~dt²): bu adım dt/16, dt/16, dt/8,
      // dt/4, dt/2 alt adımlarına bölünür; yalnızca ilk alt adım geri Euler kalır, hata ~256 kat düşer.
      if (n > 1) for (const f of [1 / 16, 1 / 8, 1 / 4, 1 / 2]) g.push(prev + f * dt);
      for (let i = 1; i <= n; i++) g.push(i === n ? next : prev + i * dt);
      if (next !== tStop) br.add(g.length - 1);
      prev = next;
    }
    return { g, br };
  };
  let { g, br } = build(h);
  if (g.length - 1 > MAX_STEPS) {
    const h2 = (h * (g.length - 1)) / MAX_STEPS;
    ({ g, br } = build(h2));
    while (g.length - 1 > MAX_STEPS && h < tStop) ({ g, br } = build((h = h * 1.5)));
    info.push(
      `Adım sayısı ${MAX_STEPS} sınırını aşacaktı: zaman adımı otomatik büyütüldü. Daha hassas sonuç için süreyi kısaltın ya da adımı büyütün.`,
    );
    h = h2;
  }
  return { h, tStop, grid: Float64Array.from(g), breaks: br, info };
}

export function solveTransient(nl: Netlist, s: AnalysisSettings): { result: TranResult; info: string[] } {
  // τ: anahtarların 0⁺ konumuyla (gösterim); zaman adımı için tüm anahtar konumlarındaki en küçük τ
  const taus = computeTaus(nl, 0);
  const allTaus: Record<string, number> = { ...taus };
  const swAt = [...new Set(nl.elements.filter((e) => e.type === 'SW' || e.type === 'SW2').flatMap((e) => e.params.times ?? []))];
  for (const ts of [-1, ...swAt]) for (const [k, v] of Object.entries(computeTaus(nl, ts))) allTaus[`${k}@${ts}`] = v;
  const { h, tStop, grid, breaks, info } = resolveTiming(nl, s, allTaus);
  const steps = grid.length - 1;
  const n = nl.nodeCount;
  const els = nl.elements;

  const t = grid;
  const nodeV: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(steps + 1));
  const cV: Record<string, Float64Array> = {};
  const cI: Record<string, Float64Array> = {};
  const pinV: Record<string, Float64Array[]> = {};
  const pinI: Record<string, Float64Array[]> = {};
  for (const e of els) {
    cV[e.id] = new Float64Array(steps + 1);
    cI[e.id] = new Float64Array(steps + 1);
  }

  // Başlangıç koşulları: anahtarlı devrelerde varsayılan 'auto' (t < 0 DC çözümü, süreklilik)
  const ic = initialConditions(nl, info);
  const state = new Map<string, { v: number; i: number }>();
  for (const e of els) {
    if (e.type === 'C') state.set(e.id, { v: ic.v0.get(e.id) ?? 0, i: 0 });
    else if (e.type === 'L') state.set(e.id, { v: 0, i: ic.i0.get(e.id) ?? 0 });
  }
  // tran0 adımı başlangıç değerlerini elemanın v0 / i0 parametresinden okur
  const nl0: Netlist = {
    ...nl,
    elements: els.map((e) =>
      e.type === 'C' ? { ...e, params: { ...e.params, v0: ic.v0.get(e.id) ?? 0 } } : e.type === 'L' ? { ...e, params: { ...e.params, i0: ic.i0.get(e.id) ?? 0 } } : e,
    ),
  };
  let after: Record<string, { V: number; I: number }> | undefined;

  const record = (k: number, sys: MNASystem, x: ArrayLike<number>, ctx: StampCtx, list = els) => {
    const sol = solutionFrom(sys, { re: x });
    nodeV[0][k] = 0;
    for (let i = 1; i <= n; i++) nodeV[i][k] = x[i - 1];
    for (const e of list) {
      const m = measureElement(e, ctx, sol);
      cV[e.id][k] = m.V.re;
      cI[e.id][k] = m.I.re;
      if (m.pinV) {
        const pv = (pinV[e.id] ??= m.pinV.map(() => new Float64Array(steps + 1)));
        const pi = (pinI[e.id] ??= m.pinV.map(() => new Float64Array(steps + 1)));
        m.pinV.forEach((z, i) => (pv[i][k] = z.re));
        m.pinI?.forEach((z, i) => (pi[i][k] = z.re));
      }
    }
  };

  // t = 0: kapasitör v0 değerinde gerilim kaynağı, bobin i0 değerinde akım kaynağı
  let t0ok = false;
  {
    const ctx0 = makeCtx('tran0', nl0, { t: 0, h: t[1] - t[0], state });
    const sys0 = newSystem(nl0, ctx0, false);
    stampAll(sys0, nl0, ctx0);
    try {
      const x0 = sys0.solveReal();
      record(0, sys0, x0, ctx0, nl0.elements);
      t0ok = true;
      after = {};
      for (const e of els) after[e.id] = { V: cV[e.id][0], I: cI[e.id][0] };
    } catch (err) {
      if (!(err instanceof SingularMatrixError)) throw err;
    }
  }

  // Matris yalnızca adım uzunluğu ya da yöntem değişince yeniden ayrıştırılır;
  // her adımda sadece sağ taraf yeniden damgalanır.
  const ctx = makeCtx('tran', nl, { h: t[1] - t[0], state, t: t[1], trap: false });
  const systems = new Map<string, { sys: MNASystem; lu: LUReal }>();
  const switches = els.filter((e) => e.type === 'SW' || e.type === 'SW2');
  const swKey = () => switches.map((e) => switchToggles(e, ctx) % 2).join('');
  const systemFor = (dt: number, trap: boolean, track = false) => {
    const key = `${trap ? 'trap' : 'be'}|${dt.toPrecision(10)}|${swKey()}`;
    let entry = systems.get(key);
    if (!entry) {
      ctx.trap = trap;
      ctx.h = dt;
      const sys = newSystem(nl, ctx, track);
      stampAll(sys, nl, ctx);
      entry = { sys, lu: luFactor(sys.realMatrix(), sys.N) };
      sys.rhsOnly = true;
      if (systems.size > 64) systems.clear();
      systems.set(key, entry);
    }
    return entry;
  };

  const useTrap = s.method === 'trap';
  // kararsızlık eşiği: kaynak ve başlangıç değerlerinin ölçeği
  let scale = 1e-3;
  for (const e of els) {
    if (e.type === 'V' || e.type === 'I')
      scale = Math.max(scale, Math.abs(sourceAt(e, 0)), Math.abs(sourceAt(e, tStop)), Math.abs(Number(e.params.amp ?? 0)), Math.abs(Number(e.params.w1 ?? 0)), Math.abs(Number(e.params.wk ?? 0)));
    if (e.type === 'C') scale = Math.max(scale, Math.abs(ic.v0.get(e.id) ?? 0));
  }
  const limit = 1e6 * scale;
  let lastStep = steps;
  let dump: TranResult['system'] | null = null;

  for (let k = 1; k <= steps; k++) {
    const dt = t[k] - t[k - 1];
    // ilk adımda ve her kırılma noktasından sonraki adımda geri Euler (trapez ani kenarlarda salınım yapar)
    const trap = useTrap && k > 1 && !breaks.has(k - 1);
    ctx.t = t[k];
    // Kırılma noktasında BİTEN adım kaynağın kenardan önceki değerini kullanır; yoksa kenar
    // bir adım erken uygulanmış olur (anahtarlar zaten t⁻ durumuyla damgalanıyor).
    ctx.tSrc = breaks.has(k) || k === steps ? t[k] - dt * 1e-6 : undefined;
    const { sys, lu } = systemFor(dt, trap, k === 1);
    ctx.h = dt;
    ctx.trap = trap;
    sys.clearRhs();
    stampAll(sys, nl, ctx);
    const x = luSolve(lu, sys.bre);
    if (k === 1) {
      dump = sys.dump(
        { re: x },
        false,
        `Geçici rejim, ilk adım (t = h = ${dt.toPrecision(4)} s, geri Euler). Kapasitör: G = C/h ve I = (C/h)·v(n−1); bobin: G = h/L ve I = i(n−1).`,
      );
    }
    record(k, sys, x, ctx);
    for (const e of els) {
      if (e.type === 'C' || e.type === 'L') state.set(e.id, { v: cV[e.id][k], i: cI[e.id][k] });
    }
    // Kararsız devre: değerler başlangıç ölçeğinin 10⁶ katına ulaşınca dur
    let big = 0;
    for (let i = 1; i <= n; i++) big = Math.max(big, Math.abs(nodeV[i][k]));
    if (big > limit) {
      lastStep = k;
      info.push(`Değerler 10⁶ katına ulaştığı için simülasyon t = ${t[k].toPrecision(3)} s'de durduruldu: devre kararsız (doğal yanıt büyüyor).`);
      break;
    }
  }
  if (!t0ok) {
    // t = 0 çözülemediyse (ör. kapasitör doğrudan kaynağa paralel) ilk adım kullanılır
    for (let i = 0; i <= n; i++) nodeV[i][0] = nodeV[i][1];
    for (const e of els) {
      cV[e.id][0] = cV[e.id][1];
      cI[e.id][0] = cI[e.id][1];
    }
  }

  const cut = <T extends Float64Array>(a: T) => (lastStep < steps ? (a.subarray(0, lastStep + 1) as T) : a);
  const comps: TranResult['comps'] = {};
  for (const e of els) comps[e.id] = { V: cut(cV[e.id]), I: cut(cI[e.id]), pinV: pinV[e.id]?.map(cut), pinI: pinI[e.id]?.map(cut) };
  return {
    result: {
      kind: 'transient',
      t: cut(t),
      nodeV: nodeV.map(cut),
      comps,
      tau: taus,
      h,
      tStop: lastStep < steps ? t[lastStep] : tStop,
      method: s.method,
      system: dump!,
      initial: ic.hasSwitch && ic.before && after ? { before: ic.before, after } : undefined,
    },
    info,
  };
}
