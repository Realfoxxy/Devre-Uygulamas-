// Geçici rejim analizi (companion model). Her adımda kapasitör ve bobin,
// bir önceki adımın değerine bağlı bir iletkenlik + paralel akım kaynağına dönüşür
// ve devre DC gibi çözülür. Geri Euler (kararlı) ya da trapez yöntemi.
import { cx } from '../core/complex';
import type { AnalysisSettings } from '../core/circuit';
import type { Netlist, NetElement } from '../core/netlist';
import type { TranResult } from '../core/results';
import { luFactor, luSolve, LUReal, SingularMatrixError } from './lu';
import { MNASystem } from './mna';

export const MAX_STEPS = 20000;

export function sourceAt(e: NetElement, t: number): number {
  const p = e.params;
  if (p.mode === 'AC') {
    return Number(p.amp ?? 0) * Math.sin(2 * Math.PI * Number(p.freq ?? 0) * t + (Number(p.phase ?? 0) * Math.PI) / 180);
  }
  return Number(p.value ?? 0);
}

/**
 * Her kapasitör / bobinin gördüğü Thevenin direncinden zaman sabiti:
 * kaynaklar sıfırlanır, eleman çıkarılıp uçlarına 1 A test akımı verilir.
 * Birinci dereceden RC / RL devrelerinde tam sonuç verir.
 */
export function computeTaus(nl: Netlist): Record<string, number> {
  const taus: Record<string, number> = {};
  const GMIN = 1e-12;
  for (const x of nl.elements) {
    if (x.type !== 'C' && x.type !== 'L') continue;
    const [a, b] = x.nodes;
    if (a === b) continue;
    const others = nl.elements.filter((e) => e.id !== x.id);
    const branchIds = others.filter((e) => e.type === 'V' || e.type === 'AM' || e.type === 'L').map((e) => e.id);
    const sys = new MNASystem(nl.nodeCount, branchIds, false);
    for (let k = 1; k <= nl.nodeCount; k++) sys.stampAdmittance(k, 0, cx(GMIN));
    for (const e of others) {
      const [p, q] = e.nodes;
      if (e.type === 'R') sys.stampAdmittance(p, q, cx(1 / Number(e.params.value)));
      else if (e.type === 'V' || e.type === 'AM' || e.type === 'L') sys.stampVoltage(p, q, e.id, cx(0));
      // I, C, VM: açık
    }
    sys.stampCurrent(b, a, cx(1)); // 1 A, a düğümüne girer
    try {
      const v = sys.solveReal();
      const va = a > 0 ? v[a - 1] : 0;
      const vb = b > 0 ? v[b - 1] : 0;
      const Rth = va - vb;
      if (!(Rth > 1e-9) || Rth > 1e9) continue;
      const val = Number(x.params.value);
      taus[x.id] = x.type === 'C' ? Rth * val : val / Rth;
    } catch {
      /* τ tanımsız */
    }
  }
  return taus;
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
  const branchIds = els.filter((e) => e.type === 'V' || e.type === 'AM').map((e) => e.id);
  const N = n + branchIds.length;
  const bIdx = new Map(branchIds.map((id, k) => [id, n + k]));

  const t = new Float64Array(steps + 1);
  const nodeV: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(steps + 1));
  const cV: Record<string, Float64Array> = {};
  const cI: Record<string, Float64Array> = {};
  for (const e of els) {
    cV[e.id] = new Float64Array(steps + 1);
    cI[e.id] = new Float64Array(steps + 1);
  }

  // Reaktif elemanların durumu
  const vPrev = new Map<string, number>();
  const iPrev = new Map<string, number>();
  for (const e of els) {
    if (e.type === 'C') {
      vPrev.set(e.id, Number(e.params.v0 ?? 0));
      iPrev.set(e.id, 0);
    } else if (e.type === 'L') {
      iPrev.set(e.id, Number(e.params.i0 ?? 0));
      vPrev.set(e.id, 0);
    }
  }

  const buildSystem = (trap: boolean, track: boolean): MNASystem => {
    const sys = new MNASystem(n, branchIds, track);
    for (const e of els) {
      const [a, b] = e.nodes;
      const val = Number(e.params.value);
      if (e.type === 'R') sys.stampAdmittance(a, b, cx(1 / val), e.id);
      else if (e.type === 'C') sys.stampAdmittance(a, b, cx(((trap ? 2 : 1) * val) / h), e.id);
      else if (e.type === 'L') sys.stampAdmittance(a, b, cx(h / ((trap ? 2 : 1) * val)), e.id);
      else if (e.type === 'V' || e.type === 'AM') sys.stampVoltage(a, b, e.id, cx(0), e.id);
    }
    return sys;
  };
  const geq = (e: NetElement, trap: boolean) => {
    const val = Number(e.params.value);
    return e.type === 'C' ? ((trap ? 2 : 1) * val) / h : h / ((trap ? 2 : 1) * val);
  };
  const ieq = (e: NetElement, trap: boolean) => {
    const G = geq(e, trap);
    const vp = vPrev.get(e.id)!;
    const ip = iPrev.get(e.id)!;
    if (e.type === 'C') return trap ? G * vp + ip : G * vp;
    return trap ? ip + G * vp : ip;
  };

  /** Adımın sağ taraf vektörü; sys verilirse damga sahipleri de kaydedilir. */
  const rhsAt = (time: number, trap: boolean, sys?: MNASystem): Float64Array => {
    const r = new Float64Array(N);
    const inj = (k: number, v: number) => {
      if (k > 0) r[k - 1] += v;
    };
    for (const e of els) {
      const [a, b] = e.nodes;
      if (e.type === 'V') {
        const v = sourceAt(e, time);
        r[bIdx.get(e.id)!] += v;
        sys?.addB(bIdx.get(e.id)!, v, 0, e.id);
      } else if (e.type === 'I') {
        const I = sourceAt(e, time);
        inj(a, -I);
        inj(b, I);
        sys?.stampCurrent(a, b, cx(I), e.id);
      } else if (e.type === 'C') {
        const I = ieq(e, trap); // b'den a'ya
        inj(a, I);
        inj(b, -I);
        sys?.stampCurrent(b, a, cx(I), e.id);
      } else if (e.type === 'L') {
        const I = ieq(e, trap); // a'dan b'ye
        inj(a, -I);
        inj(b, I);
        sys?.stampCurrent(a, b, cx(I), e.id);
      }
    }
    return r;
  };

  const record = (k: number, x: ArrayLike<number>, trap: boolean | null) => {
    nodeV[0][k] = 0;
    for (let i = 1; i <= n; i++) nodeV[i][k] = x[i - 1];
    for (const e of els) {
      const [a, b] = e.nodes;
      const v = nodeV[a][k] - nodeV[b][k];
      let i = 0;
      if (e.type === 'R') i = v / Number(e.params.value);
      else if (e.type === 'V' || e.type === 'AM') i = x[bIdx.get(e.id)!];
      else if (e.type === 'I') i = sourceAt(e, t[k]);
      else if ((e.type === 'C' || e.type === 'L') && trap !== null) {
        const G = geq(e, trap);
        i = e.type === 'C' ? G * v - ieq(e, trap) : G * v + ieq(e, trap);
      }
      cV[e.id][k] = e.type === 'AM' ? 0 : v;
      cI[e.id][k] = i;
    }
  };

  // t = 0: kapasitör v0 değerinde gerilim kaynağı, bobin i0 değerinde akım kaynağı
  let t0ok = false;
  {
    const ids0 = [...branchIds, ...els.filter((e) => e.type === 'C').map((e) => e.id)];
    const sys0 = new MNASystem(n, ids0, false);
    for (const e of els) {
      const [a, b] = e.nodes;
      if (e.type === 'R') sys0.stampAdmittance(a, b, cx(1 / Number(e.params.value)));
      else if (e.type === 'V') sys0.stampVoltage(a, b, e.id, cx(sourceAt(e, 0)));
      else if (e.type === 'AM') sys0.stampVoltage(a, b, e.id, cx(0));
      else if (e.type === 'C') sys0.stampVoltage(a, b, e.id, cx(Number(e.params.v0 ?? 0)));
      else if (e.type === 'I') sys0.stampCurrent(a, b, cx(sourceAt(e, 0)));
      else if (e.type === 'L') sys0.stampCurrent(a, b, cx(Number(e.params.i0 ?? 0)));
    }
    try {
      const x0 = sys0.solveReal();
      record(0, x0, null);
      for (const e of els) {
        if (e.type === 'C') {
          cV[e.id][0] = Number(e.params.v0 ?? 0);
          cI[e.id][0] = x0[sys0.branch(e.id)];
        } else if (e.type === 'L') cI[e.id][0] = Number(e.params.i0 ?? 0);
      }
      t0ok = true;
    } catch (err) {
      if (!(err instanceof SingularMatrixError)) throw err;
    }
  }

  const useTrap = s.method === 'trap';
  const sysBE = buildSystem(false, true);
  const luBE = luFactor(sysBE.realMatrix(), N);
  let luTR: LUReal | null = null;
  if (useTrap) luTR = luFactor(buildSystem(true, false).realMatrix(), N);

  // "Çözümü göster" için ilk adımın sistemi
  const rhs1 = rhsAt(h, false, sysBE);
  const x1 = luSolve(luBE, rhs1);
  const dump = sysBE.dump(
    { re: x1 },
    false,
    `Geçici rejim, ilk adım (t = h = ${h.toPrecision(4)} s, geri Euler). Kapasitör: G = C/h ve I = (C/h)·v(n−1); bobin: G = h/L ve I = i(n−1).`,
  );

  for (let k = 1; k <= steps; k++) {
    t[k] = k * h;
    const trap = useTrap && k > 1; // ilk adım her zaman geri Euler
    const lu = trap ? luTR! : luBE;
    const x = k === 1 ? x1 : luSolve(lu, rhsAt(t[k], trap));
    record(k, x, trap);
    for (const e of els) {
      if (e.type === 'C' || e.type === 'L') {
        vPrev.set(e.id, cV[e.id][k]);
        iPrev.set(e.id, cI[e.id][k]);
      }
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
    result: { kind: 'transient', t, nodeV, comps, tau: taus, h, tStop, method: s.method, system: dump },
    info,
  };
}
