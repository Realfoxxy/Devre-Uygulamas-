// AC (fazör) analiz: matris karmaşık sayılarla kurulur.
// Y_C = jωC, Y_L = 1/(jωL), ω = 2πf. Fazör genliği tepe değerdir.
import { Complex, ZERO, abs, conj, cx, fromPolar, mul } from '../core/complex';
import type { AnalysisSettings } from '../core/circuit';
import type { Netlist, NetElement } from '../core/netlist';
import type { ACComp, ACResult, ACSweep } from '../core/results';
import { impedanceOf, makeCtx, measureElement, newSystem, solutionFrom, stampAll } from './stamp';

export function acPhasor(e: NetElement): Complex {
  if (e.params.mode !== 'AC') return ZERO;
  return fromPolar(Number(e.params.amp ?? 0), Number(e.params.phase ?? 0));
}

/** Analiz frekansını belirler: ayarda varsa o, yoksa AC kaynakların ortak frekansı. */
export function resolveAcFrequency(nl: Netlist, s: AnalysisSettings): { freq?: number; error?: string } {
  if (s.freq && s.freq > 0) return { freq: s.freq };
  const fs = [
    ...new Set(
      nl.elements.filter((e) => (e.type === 'V' || e.type === 'I') && e.params.mode === 'AC').map((e) => Number(e.params.freq)),
    ),
  ];
  if (fs.length === 1) return { freq: fs[0] };
  if (fs.length === 0) return { error: 'AC analiz için bir AC kaynak ekleyin ya da analiz frekansını girin.' };
  return { error: 'AC kaynakların frekansları farklı: analiz ayarlarından tek bir frekans girin.' };
}

function solveAt(nl: Netlist, f: number, track: boolean) {
  const ctx = makeCtx('ac', nl, { w: 2 * Math.PI * f });
  const sys = newSystem(nl, ctx, track);
  stampAll(sys, nl, ctx);
  const x = sys.solveComplex();
  const sol = solutionFrom(sys, x);
  const nodeV: Complex[] = [ZERO];
  for (let k = 1; k <= nl.nodeCount; k++) nodeV.push(cx(x.re[k - 1], x.im[k - 1]));
  const comps: Record<string, ACComp> = {};
  for (const e of nl.elements) {
    const m = measureElement(e, ctx, sol);
    const Z = impedanceOf(e, ctx.w);
    comps[e.id] = { V: m.V, I: m.I, Z, P: mul(m.V, conj(m.I)).re / 2, pinV: m.pinV, pinI: m.pinI };
  }
  return { sys, x, nodeV, comps };
}

export function solveAC(nl: Netlist, s: AnalysisSettings, freq: number): ACResult {
  const { sys, x, nodeV, comps } = solveAt(nl, freq, true);
  const result: ACResult = {
    kind: 'ac',
    freq,
    nodeV,
    comps,
    system: sys.dump(x, true, `AC fazör analiz, f = ${freq} Hz (ω = ${(2 * Math.PI * freq).toPrecision(5)} rad/s).`),
  };
  if (s.sweep) result.sweep = sweepAC(nl, s);
  return result;
}

export function sweepAC(nl: Netlist, s: AnalysisSettings): ACSweep {
  const f0 = Math.max(1e-3, Math.min(s.fStart, s.fStop));
  const f1 = Math.max(s.fStart, s.fStop);
  const decades = Math.log10(f1 / f0);
  const n = Math.max(2, Math.min(2000, Math.round(decades * s.pointsPerDecade) + 1));
  const fs: number[] = [];
  for (let i = 0; i < n; i++) fs.push(f0 * Math.pow(10, (decades * i) / (n - 1)));
  const sweep: ACSweep = { f: fs, nodeV: [], comps: {}, refId: null };
  for (const e of nl.elements) sweep.comps[e.id] = { V: [], I: [] };
  for (let k = 0; k <= nl.nodeCount; k++) sweep.nodeV.push([]);
  const ref = nl.elements.find((e) => e.type === 'V' && e.params.mode === 'AC' && abs(acPhasor(e)) > 0);
  sweep.refId = ref ? ref.id : null;
  for (const f of fs) {
    const r = solveAt(nl, f, false);
    r.nodeV.forEach((v, k) => sweep.nodeV[k].push(v));
    for (const e of nl.elements) {
      sweep.comps[e.id].V.push(r.comps[e.id].V);
      sweep.comps[e.id].I.push(r.comps[e.id].I);
    }
  }
  return sweep;
}
