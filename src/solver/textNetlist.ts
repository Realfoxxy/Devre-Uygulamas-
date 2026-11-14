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
    const pm = /^(POT|SW|VM|AM|OA|TS)/i.exec(id);
    let type = (pm ? pm[1].toUpperCase() : id[0].toUpperCase()) as CompType;
    // SW: 3 düğüm + A/B → iki yollu anahtar
    if ((type as string) === 'SW' && /^[AB]$/i.test(tok[4] ?? '')) type = 'SW2';
    const nPins = type === 'OA' || type === 'POT' || type === 'SW2' ? 3 : 2;
    const nodes = tok.slice(1, 1 + nPins).map((t) => parseInt(t, 10));
    maxNode = Math.max(maxNode, ...nodes);
    const rest = tok.slice(1 + nPins);
    const params: NetElement['params'] = {};
    const kv = (k: string) => {
      const t = rest.find((r) => r.toUpperCase().startsWith(`${k}=`));
      return t ? t.slice(k.length + 1) : undefined;
    };
    if (type === 'OA') {
      params.model = (rest[0]?.toLowerCase() as 'ideal' | 'finite' | 'offset') || 'ideal';
      Object.assign(params, { gainA: 1e5, rin: 1e6, rout: 100, vos: 5e-3, ib: 500e-9, vsat: 15, isat: 10e-3, slew: 0.5e6 });
    } else if (type === 'POT') {
      params.value = parseValue(rest[0]) ?? 0;
      params.pos = parseValue(rest[1] ?? '0.5') ?? 0.5;
    } else if (type === 'TS') {
      params.kT = parseValue(rest[0] ?? '1u') ?? 1e-6;
      params.tempC = parseValue(rest[1] ?? '25') ?? 25;
    } else if (type === 'SW2') {
      params.way = rest[0]?.toUpperCase() === 'B' ? 'B' : 'A';
      params.times = (rest[1] ?? '').split(',').filter(Boolean).map((x) => parseValue(x) ?? 0);
    } else if ((type as string) === 'SW') {
      params.sw0 = /^(closed|kapal)/i.test(rest[0] ?? '') ? 'closed' : 'open';
      params.times = (rest[1] ?? '0').split(',').filter(Boolean).map((x) => parseValue(x) ?? 0);
    } else if ((type === 'VM' || type === 'AM') && kv('R')) {
      params.real = true;
      params.rMeter = parseValue(kv('R')!) ?? 1;
    }
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
      if (rest.some((r) => /^MAN/i.test(r))) params.init = 'manual';
      if (rest.some((r) => /^AUTO/i.test(r))) params.init = 'auto';
      const ic = rest.find((r) => /^IC=/i.test(r));
      if (ic) {
        const v = parseValue(ic.slice(3)) ?? 0;
        if (type === 'C') params.v0 = v;
        else params.i0 = v;
      }
    }
    elements.push({ id, type: type as NetElement['type'], nodes, params });
  }
  return { elements, nodeCount: maxNode, pinNodes: {}, wireNodes: {}, nodeAnchors: [], issues: [] };
}
