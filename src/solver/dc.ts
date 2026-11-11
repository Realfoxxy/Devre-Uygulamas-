// DC analiz: kapasitörler açık devre, bobinler 0 V'luk gerilim kaynağı (kısa devre).
import { cx } from '../core/complex';
import type { Netlist, NetElement } from '../core/netlist';
import type { DCComp, DCResult } from '../core/results';
import { MNASystem } from './mna';

export function dcSourceValue(e: NetElement): number {
  return e.params.mode === 'AC' ? 0 : Number(e.params.value ?? 0);
}

export function solveDC(nl: Netlist): DCResult {
  const branchIds = nl.elements.filter((e) => e.type === 'V' || e.type === 'AM' || e.type === 'L').map((e) => e.id);
  const sys = new MNASystem(nl.nodeCount, branchIds);
  for (const e of nl.elements) {
    const [a, b] = e.nodes;
    switch (e.type) {
      case 'R':
        sys.stampAdmittance(a, b, cx(1 / Number(e.params.value)), e.id);
        break;
      case 'V':
        sys.stampVoltage(a, b, e.id, cx(dcSourceValue(e)), e.id);
        break;
      case 'L':
      case 'AM':
        sys.stampVoltage(a, b, e.id, cx(0), e.id);
        break;
      case 'I':
        sys.stampCurrent(a, b, cx(dcSourceValue(e)), e.id);
        break;
      // C ve VM: açık devre, damga yok
    }
  }
  const x = sys.solveReal();
  const nodeV = [0];
  for (let k = 1; k <= nl.nodeCount; k++) nodeV.push(x[k - 1]);
  const comps: Record<string, DCComp> = {};
  for (const e of nl.elements) {
    const [a, b] = e.nodes;
    const V = nodeV[a] - nodeV[b];
    let I = 0;
    switch (e.type) {
      case 'R':
        I = V / Number(e.params.value);
        break;
      case 'V':
      case 'L':
      case 'AM':
        I = x[sys.branch(e.id)];
        break;
      case 'I':
        I = dcSourceValue(e);
        break;
    }
    const Vc = e.type === 'L' || e.type === 'AM' ? 0 : V;
    comps[e.id] = { V: Vc, I, P: Vc * I };
  }
  return {
    kind: 'dc',
    nodeV,
    comps,
    system: sys.dump({ re: x }, false, 'DC: kapasitörler açık devre, bobinler 0 V kaynak (kısa devre).'),
  };
}
