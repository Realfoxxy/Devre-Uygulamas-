// Denklemleri ve devreyi başka araçlara aktarma: MATLAB, Python (NumPy), LaTeX, SPICE (.cir).
import type { Netlist } from '../../core/netlist';
import type { EqLine } from './nodal';

const n = (x: number) => (Math.abs(x) < 1e-15 ? '0' : String(parseFloat(x.toPrecision(10))));

export function toMatlab(A: number[][], b: number[], names: string[], title: string, Aname: string): string {
  const rows = A.map((r) => r.map(n).join(' ')).join('; ');
  return [
    `% ${title}`,
    `% Bilinmeyenler: ${names.join(', ')}`,
    `${Aname} = [${rows}];`,
    `b = [${b.map(n).join('; ')}];`,
    `x = ${Aname} \\ b`,
  ].join('\n');
}

export function toPython(A: number[][], b: number[], names: string[], title: string, Aname: string): string {
  return [
    `# ${title}`,
    `# Bilinmeyenler: ${names.join(', ')}`,
    'import numpy as np',
    `${Aname} = np.array([${A.map((r) => `[${r.map(n).join(', ')}]`).join(', ')}])`,
    `b = np.array([${b.map(n).join(', ')}])`,
    `x = np.linalg.solve(${Aname}, b)`,
    'print(x)',
  ].join('\n');
}

const tex = (s: string) =>
  s
    .replace(/−/g, '-')
    .replace(/·/g, ' \\cdot ')
    .replace(/µ/g, '\\mu ')
    .replace(/_([A-Za-z0-9]+)/g, '_{$1}')
    .replace(/v(\d+)/g, 'v_{$1}')
    .replace(/i(\d+)/g, 'i_{$1}');

export function toLatex(equations: EqLine[], A: number[][], b: number[], names: string[], Aname: string): string {
  const eqs = equations.map((e) => `  ${tex(e.text).replace('=', '&=')} \\\\`).join('\n');
  const mat = A.map((r) => r.map(n).join(' & ')).join(' \\\\ ');
  return [
    '\\begin{align*}',
    eqs,
    '\\end{align*}',
    '\\[',
    `\\underbrace{\\begin{bmatrix} ${mat} \\end{bmatrix}}_{${Aname}}`,
    `\\begin{bmatrix} ${names.map(tex).join(' \\\\ ')} \\end{bmatrix} =`,
    `\\begin{bmatrix} ${b.map(n).join(' \\\\ ')} \\end{bmatrix}`,
    '\\]',
  ].join('\n');
}

/** LTspice / PSpice uyumlu netlist. Ampermetre 0 V'luk kaynak olur; voltmetre yorum satırıdır. */
export function toSpice(nl: Netlist, title = 'Devre Lab Simülatörü'): string {
  const lines = [`* ${title}`];
  const byId = new Map(nl.elements.map((e) => [e.id, e]));
  const vname = (id: string) => {
    const e = byId.get(id);
    return e?.type === 'V' ? id : `V${id}`;
  };
  for (const e of nl.elements) {
    const [a, b] = e.nodes;
    const p = e.params;
    const ref = p.ctrl?.ref ? byId.get(p.ctrl.ref) : undefined;
    switch (e.type) {
      case 'R':
      case 'C':
      case 'L': {
        let l = `${e.id} ${a} ${b} ${n(Number(p.value))}`;
        if (e.type === 'C' && p.v0) l += ` IC=${n(p.v0)}`;
        if (e.type === 'L' && p.i0) l += ` IC=${n(p.i0)}`;
        lines.push(l);
        break;
      }
      case 'V':
      case 'I':
        lines.push(
          p.mode === 'AC'
            ? `${e.id} ${a} ${b} AC ${n(Number(p.amp))} ${n(Number(p.phase ?? 0))}`
            : `${e.id} ${a} ${b} DC ${n(Number(p.value ?? 0))}`,
        );
        break;
      case 'AM':
        lines.push(`V${e.id} ${a} ${b} DC 0 ; ampermetre`);
        break;
      case 'VM':
        lines.push(`* ${e.id}: voltmetre, düğüm ${a} – ${b}`);
        break;
      case 'E':
      case 'G':
        if (ref) lines.push(`${e.id} ${a} ${b} ${ref.nodes[0]} ${ref.nodes[1]} ${n(Number(p.gain))}`);
        break;
      case 'F':
      case 'H':
        if (!ref) break;
        if (ref.type === 'R') {
          // SPICE'ta akım ölçen kaynak gerekir: direnç akımı → gerilim kontrolüne çevrilir
          const g = Number(p.gain) / Number(ref.params.value);
          lines.push(`${e.type === 'F' ? 'G' : 'E'}${e.id} ${a} ${b} ${ref.nodes[0]} ${ref.nodes[1]} ${n(g)} ; ${e.id} = ${n(Number(p.gain))}·i(${ref.id})`);
        } else lines.push(`${e.id} ${a} ${b} ${vname(ref.id)} ${n(Number(p.gain))}`);
        break;
    }
  }
  lines.push('.op', '.end');
  return lines.join('\n');
}
