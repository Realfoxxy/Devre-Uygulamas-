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

export { sourceAt } from './waveform';

export const MAX_STEPS = 20000;

/**
 * Her kapasitör / bobinin gördüğü Thevenin direncinden zaman sabiti:
 * bağımsız kaynaklar sıfırlanır (bağımlılar kalır), eleman çıkarılıp uçlarına
 * 1 A test akımı verilir. Birinci dereceden RC / RL devrelerinde tam sonuç verir.
 */
export function computeTaus(nl: Netlist): Record<string, number> {
  const taus: Record<string, number> = {};
  for (const x of nl.elements) {
    if (x.type !== 'C' && x.type !== 'L') continue;
    const r = theveninResistance(nl, x.nodes[0], x.nodes[1], new Set([x.id]));
    if (r === null || !(r > 1e-9) || r > 1e9) continue;
    const val = Number(x.params.value);
    taus[x.id] = x.type === 'C' ? r * val : val / r;
  }
  return taus;
}

/** a–b uçlarından görülen direnç (DC, bağımsız kaynaklar sıfır, bağımlılar kalır). Tanımsızsa null. */
export function theveninResistance(nl: Netlist, a: number, b: number, exclude: Set<string>): number | null {
  if (a === b) return null;
  const GMIN = 1e-12;
  const ctx = makeCtx('dc', nl, { zero: true, exclude });
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
  steps: number;
  info: string[];
}

export function resolveTiming(nl: Netlist, s: AnalysisSettings, taus: Record<string, number>): TranTiming {
  const info: string[] = [];
  const tv = Object.values(taus);
  const freqs = nl.elements
    .filter((e) => (e.type === 'V' || e.type === 'I') && e.params.mode === 'AC' && Number(e.params.freq) > 0)
    .map((e) => Number(e.params.freq));
  const minTau = tv.length ? Math.min(...tv) : Infinity;
  const maxTau = tv.length ? Math.max(...tv) : 0;
  const minPeriod = freqs.length ? 1 / Math.max(...freqs) : Infinity;
  const maxPeriod = freqs.length ? 1 / Math.min(...freqs) : 0;

  let tStop = s.tStop && s.tStop > 0 ? s.tStop : 0;
  if (!tStop) {
    tStop = Math.max(5 * maxTau, 5 * maxPeriod);
    if (!tStop) tStop = 10e-3;
    info.push(`Toplam süre otomatik: ${tStop.toPrecision(3)} s (${maxTau ? '5τ' : '5 periyot'}).`);
  }
  let h = s.h && s.h > 0 ? s.h : 0;
  if (!h) {
    h = Math.min(minTau / 50, minPeriod / 50, tStop / 200);
    info.push(`Zaman adımı otomatik: h = ${h.toPrecision(3)} s (en küçük τ veya periyodun 1/50'si).`);
  }
  let steps = Math.ceil(tStop / h - 1e-9);
  if (steps > MAX_STEPS) {
    steps = MAX_STEPS;
    info.push(`Adım sayısı ${MAX_STEPS} ile sınırlandı; zaman adımı büyütüldü.`);
  }
  steps = Math.max(steps, 1);
  h = tStop / steps;
  return { h, tStop, steps, info };
}

export function solveTransient(nl: Netlist, s: AnalysisSettings): { result: TranResult; info: string[] } {
  const taus = computeTaus(nl);
  const { h, tStop, steps, info } = resolveTiming(nl, s, taus);
  const n = nl.nodeCount;
  const els = nl.elements;

  const t = new Float64Array(steps + 1);
  const nodeV: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(steps + 1));
  const cV: Record<string, Float64Array> = {};
  const cI: Record<string, Float64Array> = {};
  for (const e of els) {
    cV[e.id] = new Float64Array(steps + 1);
    cI[e.id] = new Float64Array(steps + 1);
  }

  // Reaktif elemanların durumu
  const state = new Map<string, { v: number; i: number }>();
  for (const e of els) {
    if (e.type === 'C') state.set(e.id, { v: Number(e.params.v0 ?? 0), i: 0 });
    else if (e.type === 'L') state.set(e.id, { v: 0, i: Number(e.params.i0 ?? 0) });
  }

  const record = (k: number, sys: MNASystem, x: ArrayLike<number>, ctx: StampCtx) => {
    const sol = solutionFrom(sys, { re: x });
    nodeV[0][k] = 0;
    for (let i = 1; i <= n; i++) nodeV[i][k] = x[i - 1];
    for (const e of els) {
      const { V, I } = measureElement(e, ctx, sol);
      cV[e.id][k] = V.re;
      cI[e.id][k] = I.re;
    }
  };

  // t = 0: kapasitör v0 değerinde gerilim kaynağı, bobin i0 değerinde akım kaynağı
  let t0ok = false;
  {
    const ctx0 = makeCtx('tran0', nl, { t: 0, h, state });
    const sys0 = newSystem(nl, ctx0, false);
    stampAll(sys0, nl, ctx0);
    try {
      const x0 = sys0.solveReal();
      record(0, sys0, x0, ctx0);
      t0ok = true;
    } catch (err) {
      if (!(err instanceof SingularMatrixError)) throw err;
    }
  }

  // Matris yalnızca yöntem (BE / trapez) değişince yeniden ayrıştırılır;
  // her adımda sadece sağ taraf yeniden damgalanır.
  const ctx = makeCtx('tran', nl, { h, state, t: h, trap: false });
  const systems = new Map<string, { sys: MNASystem; lu: LUReal }>();
  const systemFor = (trap: boolean, track = false) => {
    const key = trap ? 'trap' : 'be';
    let entry = systems.get(key);
    if (!entry) {
      ctx.trap = trap;
      const sys = newSystem(nl, ctx, track);
      stampAll(sys, nl, ctx);
      entry = { sys, lu: luFactor(sys.realMatrix(), sys.N) };
      sys.rhsOnly = true;
      systems.set(key, entry);
    }
    return entry;
  };

  // "Çözümü göster" için ilk adımın sistemi (geri Euler)
  const first = systemFor(false, true);
  const useTrap = s.method === 'trap';
  let dump: TranResult['system'] | null = null;

  for (let k = 1; k <= steps; k++) {
    t[k] = k * h;
    const trap = useTrap && k > 1; // ilk adım her zaman geri Euler
    const { sys, lu } = k === 1 ? first : systemFor(trap);
    ctx.t = t[k];
    ctx.trap = trap;
    sys.clearRhs();
    stampAll(sys, nl, ctx);
    const x = luSolve(lu, sys.bre);
    if (k === 1) {
      dump = sys.dump(
        { re: x },
        false,
        `Geçici rejim, ilk adım (t = h = ${h.toPrecision(4)} s, geri Euler). Kapasitör: G = C/h ve I = (C/h)·v(n−1); bobin: G = h/L ve I = i(n−1).`,
      );
    }
    record(k, sys, x, ctx);
    for (const e of els) {
      if (e.type === 'C' || e.type === 'L') state.set(e.id, { v: cV[e.id][k], i: cI[e.id][k] });
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

  const comps: TranResult['comps'] = {};
  for (const e of els) comps[e.id] = { V: cV[e.id], I: cI[e.id] };
  return {
    result: { kind: 'transient', t, nodeV, comps, tau: taus, h, tStop, method: s.method, system: dump! },
    info,
  };
}
