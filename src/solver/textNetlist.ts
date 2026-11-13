// Metin netlistini okur (testler ve hızlı denemeler için):
//   V1 1 0 DC 12 | V1 1 0 AC 5 1000 0 | R1 1 2 1k | C1 2 0 100u IC=0 | I1 0 1 1m
import type { CompType } from '../core/circuit';
import type { Netlist, NetElement } from '../core/netlist';
import { parseValue } from '../core/units';

export function parseNetlistText(text: string): Netlist {
  const elements: NetElement[] = [];
  let maxNode = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('*') || line.startsWith('#')) continue;
    const tok = line.split(/\s+/);
    const id = tok[0];
    const type = (/^(VM|AM)/i.test(id) ? id.slice(0, 2).toUpperCase() : id[0].toUpperCase()) as CompType;
    const a = parseInt(tok[1], 10);
    const b = parseInt(tok[2], 10);
    maxNode = Math.max(maxNode, a, b);
    const rest = tok.slice(3);
    const params: NetElement['params'] = {};
    if (type === 'V' || type === 'I') {
      if (rest[0]?.toUpperCase() === 'AC') {
        params.mode = 'AC';
        params.amp = parseValue(rest[1]) ?? 0;
        params.freq = parseValue(rest[2]) ?? 0;
        params.phase = parseValue(rest[3] ?? '0') ?? 0;
      } else {
        params.mode = 'DC';
        params.value = parseValue(rest[0]?.toUpperCase() === 'DC' ? rest[1] : rest[0]) ?? 0;
      }
    } else if (type === 'E' || type === 'F' || type === 'G' || type === 'H') {
      params.gain = parseValue(rest[0]) ?? 0;
      if (rest[1]) params.ctrl = { ref: rest[1], kind: type === 'E' || type === 'G' ? 'V' : 'I' };
    } else if (type === 'R' || type === 'C' || type === 'L') {
      params.value = parseValue(rest[0]) ?? 0;
      const ic = rest.find((r) => /^IC=/i.test(r));
      if (ic) {
        const v = parseValue(ic.slice(3)) ?? 0;
        if (type === 'C') params.v0 = v;
        else params.i0 = v;
      }
    }
    elements.push({ id, type: type as NetElement['type'], nodes: [a, b], params });
  }
  return { elements, nodeCount: maxNode, pinNodes: {}, wireNodes: {}, nodeAnchors: [], issues: [] };
}
