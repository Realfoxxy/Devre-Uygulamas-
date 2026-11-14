// DC analiz: kapasitörler açık devre, bobinler 0 V'luk gerilim kaynağı (kısa devre).
import type { Netlist } from '../core/netlist';
import type { DCComp, DCResult } from '../core/results';
import { makeCtx, measureElement, newSystem, solutionFrom, stampAll, StampCtx } from './stamp';

export function solveDC(nl: Netlist, extra: Partial<StampCtx> = {}): DCResult {
  const ctx = makeCtx('dc', nl, extra);
  const sys = newSystem(nl, ctx);
  stampAll(sys, nl, ctx);
  const x = sys.solveReal();
  const sol = solutionFrom(sys, { re: x });
  const nodeV = [0];
  for (let k = 1; k <= nl.nodeCount; k++) nodeV.push(x[k - 1]);
  const comps: Record<string, DCComp> = {};
  for (const e of nl.elements) {
    if (ctx.exclude?.has(e.id)) continue;
    const m = measureElement(e, ctx, sol);
    // çok uçlu elemanlarda soğurulan güç Σ v_k·i_k (i_k: pinden giren akım)
    const P = m.pinV && m.pinI ? m.pinV.reduce((s, v, k) => s + v.re * m.pinI![k].re, 0) : m.V.re * m.I.re;
    comps[e.id] = { V: m.V.re, I: m.I.re, P };
    if (m.pinV) comps[e.id].pinV = m.pinV.map((z) => z.re);
    if (m.pinI) comps[e.id].pinI = m.pinI.map((z) => z.re);
  }
  return {
    kind: 'dc',
    nodeV,
    comps,
    system: sys.dump({ re: x }, false, 'DC: kapasitörler açık devre, bobinler 0 V kaynak (kısa devre).'),
  };
}
