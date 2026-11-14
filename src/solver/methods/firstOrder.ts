// Birinci derece devrelerin tam yanıtı (Bölüm 8.2–8.7): her anahtarlama / basamak aralığında
// x(t) = x_f(t) + [x(t₀⁺) − x_f(t₀⁺)]·e^(−(t − t₀)/τ); sabit girişte x_f = x(∞).
import { abs, arg, cx } from '../../core/complex';
import type { Netlist, NetElement } from '../../core/netlist';
import type { TranResult } from '../../core/results';
import { formatEng } from '../../core/units';
import { SingularMatrixError } from '../lu';
import { makeCtx, measureElement, newSystem, solutionFrom, stampAll } from '../stamp';
import { theveninResistance } from '../transient';
import { breakpoints, waveAt } from '../waveform';

export interface FOInterval {
  t0: number;
  t1: number;
  x0: number;
  /** Sabit girişte x(∞) */
  xinf: number | null;
  Rth: number | null;
  tau: number | null;
  /** Formül metni (sayılarla) */
  formula: string | null;
  tauText: string;
  forcedText?: string;
  note?: string;
  /** Formül ile simülasyon arasındaki en büyük fark (salınıma göre %) */
  deviation?: number;
  /** Formülün değerlendirilmesi */
  evalAt?: (t: number) => number;
}

export interface FirstOrderResult {
  applicable: boolean;
  reason?: string;
  elem?: string;
  kind?: 'C' | 'L';
  symbol?: string;
  unit?: string;
  intervals: FOInterval[];
  warnings: string[];
  unstable?: boolean;
}

const CONST_MODES = new Set([undefined, 'DC', 'STEP', 'PULSE']);

function nearest(t: ArrayLike<number>, x: number) {
  let k = 0;
  for (let i = 0; i < t.length; i++) if (Math.abs(t[i] - x) < Math.abs(t[k] - x)) k = i;
  return k;
}

export function firstOrderAnalysis(nl: Netlist, res: TranResult): FirstOrderResult {
  const storage = nl.elements.filter((e) => e.type === 'C' || e.type === 'L');
  if (storage.length !== 1)
    return { applicable: false, reason: storage.length ? 'Devrede birden fazla enerji depolayan eleman var (ikinci derece: Bölüm 9).' : 'Devrede kapasitör ya da bobin yok.', intervals: [], warnings: [] };
  const el = storage[0];
  const kind = el.type as 'C' | 'L';
  const symbol = kind === 'C' ? `v_${el.id}` : `i_${el.id}`;
  const unit = kind === 'C' ? 'V' : 'A';
  const val = Number(el.params.value);
  const sources = nl.elements.filter((e) => e.type === 'V' || e.type === 'I');
  const nonConst = sources.filter((e) => !CONST_MODES.has(e.params.mode));
  const tEnd = res.t[res.t.length - 1];
  const swTimes = nl.elements.filter((e) => e.type === 'SW' || e.type === 'SW2').flatMap((e) => e.params.times ?? []);
  let cuts = [...swTimes, ...sources.filter((e) => CONST_MODES.has(e.params.mode)).flatMap((e) => breakpoints(e.params, tEnd))]
    .filter((x) => x > 1e-15 && x < tEnd - 1e-15)
    .map((x) => +x.toPrecision(12));
  cuts = [...new Set(cuts)].sort((a, b) => a - b).slice(0, 19);
  const bounds = [0, ...cuts, tEnd];
  const warnings: string[] = [];
  const intervals: FOInterval[] = [];
  const sim = kind === 'C' ? res.comps[el.id].V : res.comps[el.id].I;
  let prevEval: ((t: number) => number) | null = null;
  let unstable = false;

  const stateValue = (e: NetElement, ctxSol: ReturnType<typeof solutionFrom>, ctx: ReturnType<typeof makeCtx>) => {
    const m = measureElement(e, ctx, ctxSol);
    return kind === 'C' ? m.V : m.I;
  };

  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    const ka = nearest(res.t, a);
    // x(t₀⁺): ilk aralıkta 0⁺ değeri, sonra bir önceki formülün aralık sonundaki değeri (süreklilik)
    const x0: number = prevEval ? prevEval(a) : i === 0 && res.initial ? (kind === 'C' ? res.initial.after[el.id].V : res.initial.after[el.id].I) : sim[ka];
    const Rth = theveninResistance(nl, el.nodes[0], el.nodes[1], new Set([el.id]), a);
    const iv: FOInterval = { t0: a, t1: b, x0, xinf: null, Rth, tau: null, formula: null, tauText: '' };
    if (Rth === null) {
      iv.note = 'Bu aralıkta eleman uçlarından görülen direnç tanımsız (açık devre); τ hesaplanamadı.';
      intervals.push(iv);
      prevEval = null;
      continue;
    }
    if (Rth <= 1e-12) {
      unstable = Rth < -1e-12;
      iv.note = unstable
        ? `Bu devre kararsız: R_th = ${formatEng(Rth, 'Ω')} ≤ 0, doğal yanıt zamanla büyüyor (Bölüm 8.5). Gerçekte bağımlı kaynak veya op-amp doyuma girer.`
        : 'R_th = 0: eleman ideal bir kaynağa doğrudan bağlı; geçiş anlık olur.';
      intervals.push(iv);
      prevEval = null;
      continue;
    }
    const tau = kind === 'C' ? Rth * val : val / Rth;
    iv.tau = tau;
    iv.tauText =
      kind === 'C'
        ? `τ = R_th·C = ${formatEng(Rth, 'Ω')} · ${formatEng(val, 'F')} = ${formatEng(tau, 's')}`
        : `τ = L/R_th = ${formatEng(val, 'H')} / ${formatEng(Rth, 'Ω')} = ${formatEng(tau, 's')}`;

    // Zorlanmış yanıt: sabit kaynakların DC çözümü + sabit olmayan kaynakların katkısı
    const mid = a + Math.min((b - a) / 2, 1e-12 + (b - a) * 1e-6);
    const constOverride = new Map(sources.map((e) => [e.id, cx(CONST_MODES.has(e.params.mode) ? waveAt(e.params, mid) : 0)]));
    let xf0: number;
    try {
      const ctx = makeCtx('dc', nl, { swTime: a, sourceOverride: constOverride });
      const sys = newSystem(nl, ctx, false);
      stampAll(sys, nl, ctx);
      const x = sys.solveReal();
      xf0 = stateValue(el, solutionFrom(sys, { re: x }), ctx).re;
    } catch (e) {
      if (!(e instanceof SingularMatrixError)) throw e;
      iv.note = 'x(∞) için DC çözüm bulunamadı.';
      intervals.push(iv);
      prevEval = null;
      continue;
    }
    const parts: { text: string; f: (t: number) => number }[] = [];
    let unsupported: string | null = null;
    for (const src of nonConst) {
      const p = src.params;
      const td = Number(p.td ?? 0);
      if (p.mode === 'AC' || p.mode === 'SINE_U') {
        if (p.mode === 'SINE_U' && td > a + 1e-15) {
          unsupported = `${src.id} bu aralıkta henüz başlamadı`;
          continue;
        }
        const w = 2 * Math.PI * Number(p.freq ?? 0);
        const ctx = makeCtx('ac', nl, { w, swTime: a, zero: true, sourceOverride: new Map([[src.id, cx(Number(p.amp ?? 0), 0)]]) });
        // birim fazörle (açı 0) çöz, sonra kaynağın fazını ekle
        const sys = newSystem(nl, ctx, false);
        stampAll(sys, nl, ctx);
        const X = stateValue(el, solutionFrom(sys, sys.solveComplex()), ctx);
        const mag = abs(X);
        const ph = arg(X) + (Number(p.phase ?? 0) * Math.PI) / 180;
        parts.push({ text: `${formatEng(mag, unit)}·sin(${+(w / (2 * Math.PI)).toPrecision(4)}·2πt ${ph < 0 ? '−' : '+'} ${Math.abs((ph * 180) / Math.PI).toFixed(1)}°)`, f: (t) => mag * Math.sin(w * t + ph) });
      } else if (p.mode === 'EXP') {
        const bb = Number(p.wb ?? 0);
        if (Math.abs(bb - 1 / tau) < 1e-3 / tau) {
          unsupported = `giriş doğal yanıtla çakışıyor (b = 1/τ); zorlanmış yanıt t·e^(−t/τ) biçiminde`;
          continue;
        }
        if (td > a + 1e-15) {
          unsupported = `${src.id} bu aralıkta henüz başlamadı`;
          continue;
        }
        const ctx = makeCtx('ac', nl, { s: cx(-bb, 0), swTime: a, zero: true, sourceOverride: new Map([[src.id, cx(Number(p.wk ?? 0), 0)]]) });
        const sys = newSystem(nl, ctx, false);
        stampAll(sys, nl, ctx);
        const X = stateValue(el, solutionFrom(sys, sys.solveComplex()), ctx).re;
        parts.push({ text: `${formatEng(X, unit)}·e^(−${+bb.toPrecision(4)}·(t${td ? ` − ${formatEng(td, 's')}` : ''}))`, f: (t) => X * Math.exp(-bb * (t - td)) });
      } else {
        unsupported = `${src.id} (${p.mode === 'RAMP' ? 'rampa' : 'parçalı doğrusal'}) girişi için formül gösterilmiyor`;
      }
    }
    if (unsupported) {
      iv.note = `Formül yok: ${unsupported}; eğri simülasyondan.`;
      intervals.push(iv);
      prevEval = null;
      continue;
    }
    const xf = (t: number): number => xf0 + parts.reduce((s, q) => s + q.f(t), 0);
    const A: number = x0 - xf(a);
    const evalAt = (t: number): number => xf(t) + A * Math.exp(-(t - a) / tau);
    iv.evalAt = evalAt;
    const tt = a ? `(t − ${formatEng(a, 's')})` : 't';
    if (!parts.length) {
      iv.xinf = xf0;
      iv.formula = `${symbol}(t) = ${formatEng(xf0, unit)} + (${formatEng(x0, unit)} − ${formatEng(xf0, unit)})·e^(−${tt}/${formatEng(tau, 's')})`;
    } else {
      const forced = [Math.abs(xf0) > 1e-15 ? formatEng(xf0, unit) : '', ...parts.map((q) => q.text)].filter(Boolean).join(' + ');
      iv.forcedText = `zorlanmış: ${forced}; doğal: A·e^(−${tt}/τ), A = ${formatEng(A, unit)}`;
      iv.formula = `${symbol}(t) = ${forced} + ${formatEng(A, unit)}·e^(−${tt}/${formatEng(tau, 's')})`;
    }
    // çözücünün kendi kontrolü
    let maxDev = 0;
    let swing = 1e-15;
    for (let k = 0; k < res.t.length; k++) {
      const t = res.t[k];
      if (t < a + 1e-15 || t > b + 1e-15) continue;
      swing = Math.max(swing, Math.abs(evalAt(t) - xf(t)), Math.abs(A));
      maxDev = Math.max(maxDev, Math.abs(evalAt(t) - sim[k]));
    }
    iv.deviation = (maxDev / swing) * 100;
    if (iv.deviation > 0.5)
      warnings.push(`${a ? `${formatEng(a, 's')} sonrası` : 'İlk'} aralıkta formül ile simülasyon %${iv.deviation.toFixed(2)} farklı (zaman adımını küçültün ya da trapez yöntemini seçin).`);
    intervals.push(iv);
    prevEval = evalAt;
  }
  return { applicable: true, elem: el.id, kind, symbol, unit, intervals, warnings, unstable };
}
