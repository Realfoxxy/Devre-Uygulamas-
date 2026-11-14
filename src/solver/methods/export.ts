// Denklemleri ve devreyi başka araçlara aktarma: MATLAB, Python (NumPy), LaTeX, SPICE (.cir).
import type { AnalysisSettings } from '../../core/circuit';
import type { Netlist, NetElement } from '../../core/netlist';
import { R_OFF, R_ON, potParts } from '../stamp';
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
    .replace(/\b([vi])(\d+)\b/g, '$1_{$2}')
    .replace(/_([A-Za-z0-9]+)/g, '_{$1}');

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

export interface SpiceOptions {
  /** Analiz komutu (.op / .ac / .tran) bu ayarlardan yazılır; yoksa .op */
  analysis?: AnalysisSettings;
  /** Geçici rejimde kullanılan gerçek süre ve adım (otomatik seçildiyse sonuçtan) */
  tStop?: number;
  h?: number;
}

/**
 * ngspice / LTspice uyumlu netlist. Desteklenmeyen bir eleman sessizce atlanmaz: her eleman ya eşdeğer
 * SPICE elemanlarıyla yazılır (op-amp → VCVS, potansiyometre → iki direnç, zamanlı anahtar → gerilim
 * kontrollü anahtar …) ya da yorum satırıyla açıklanır.
 */
export function toSpice(nl: Netlist, title = 'Devre Lab Simülatörü', opt: SpiceOptions = {}): string {
  const lines = [`* ${title}`];
  const models = new Set<string>();
  const byId = new Map(nl.elements.map((e) => [e.id, e]));
  const hasSwitch = nl.elements.some((e) => e.type === 'SW' || e.type === 'SW2');
  // SPICE eleman adı türünü ilk harfle belirtir
  const nm = (letter: string, id: string) => (id.toUpperCase().startsWith(letter) ? id : `${letter}${id}`);
  const node = (k: number) => String(k);
  const eps = Math.min(1e-9, (opt.h ?? 1e-6) / 100);
  // Akımı bir bağımlı kaynağı kontrol eden elemanlar: akım SPICE'ta bir gerilim kaynağından okunur
  const senseOf = new Map<string, string>();
  for (const e of nl.elements) {
    if (e.type !== 'F' && e.type !== 'H') continue;
    const ref = e.params.ctrl?.ref ? byId.get(e.params.ctrl.ref) : undefined;
    if (!ref || ref.type === 'R') continue;
    if (ref.type === 'V' && nm('V', ref.id) === ref.id) senseOf.set(ref.id, ref.id);
    else if (ref.type === 'AM') senseOf.set(ref.id, nm('V', ref.id));
    else senseOf.set(ref.id, `VS_${ref.id}`);
  }
  /** Elemanın ikinci ucu: akımı ölçülecekse araya 0 V'luk ölçüm kaynağı girer */
  const tail = (e: NetElement): string => {
    const s = senseOf.get(e.id);
    if (!s || s === e.id || e.type === 'AM') return node(e.nodes[1]);
    lines.push(`${s} ${e.id}_s ${node(e.nodes[1])} DC 0 ; ${e.id} akımını ölçer`);
    return `${e.id}_s`;
  };
  let needUic = false;
  const srcSpec = (p: NetElement['params']): string => {
    const td = Number(p.td ?? 0);
    const w0 = Number(p.w0 ?? 0);
    const w1 = Number(p.w1 ?? 0);
    switch (p.mode) {
      case 'AC':
        return `DC 0 AC ${n(Number(p.amp))} ${n(Number(p.phase ?? 0))} SIN(0 ${n(Number(p.amp))} ${n(Number(p.freq))} 0 0 ${n(Number(p.phase ?? 0))})`;
      case 'STEP':
        return td > 0 ? `DC ${n(w0)} PWL(0 ${n(w0)} ${n(td)} ${n(w0)} ${n(td + eps)} ${n(w1)})` : `DC ${n(w0)} PWL(0 ${n(w0)} ${n(eps)} ${n(w1)})`;
      case 'PULSE': {
        const pw = Number(p.pw ?? 0);
        const per = Number(p.per ?? 0) || 1e9;
        return `DC ${n(w0)} PULSE(${n(w0)} ${n(w1)} ${n(td)} ${n(eps)} ${n(eps)} ${n(Math.max(eps, pw - eps))} ${n(per)})`;
      }
      case 'SINE_U':
        return `DC 0 SIN(0 ${n(Number(p.amp))} ${n(Number(p.freq))} ${n(td)} 0 ${n(Number(p.phase ?? 0) + 360 * Number(p.freq) * td)})`;
      case 'PWL': {
        const pts = p.pwl ?? [];
        return `DC ${n(pts[0]?.[1] ?? 0)} PWL(${pts.map(([t, v]) => `${n(t)} ${n(v)}`).join(' ')})`;
      }
      case 'EXP': {
        // k·e^(−b(t−td))·u(t−td): 12 zaman sabiti boyunca örneklenmiş PWL
        const k = Number(p.wk ?? 0);
        const b = Number(p.wb ?? 0);
        const T = b > 0 ? 12 / b : 1;
        const pts: string[] = [td > 0 ? `0 0 ${n(td)} 0` : '0 0', `${n(td + eps)} ${n(k)}`];
        for (let i = 1; i <= 120; i++) {
          const x = T * (i / 120) ** 2;
          pts.push(`${n(td + eps + x)} ${n(k * Math.exp(-b * x))}`);
        }
        return `DC 0 PWL(${pts.join(' ')})`;
      }
      case 'RAMP': {
        const k = Number(p.wk ?? 0);
        const H = Math.max(1e3, 10 * (opt.tStop ?? 0));
        return `DC 0 PWL(0 0 ${n(td)} 0 ${n(td + H)} ${n(k * H)})`;
      }
      default:
        return `DC ${n(Number(p.value ?? 0))}`;
    }
  };
  /** Zamanlı anahtar için 0 / 1 V kontrol kaynağı (t < 0 konumu ve değişim anları) */
  const switchCtl = (name: string, closed0: boolean, times: number[]) => {
    const ts = [...times].filter((t) => t >= 0).sort((a, b) => a - b);
    // t < 0'daki değişimler başlangıç konumunu belirler
    let on = times.filter((t) => t < 0).length % 2 === 0 ? closed0 : !closed0;
    const pts = [`0 ${on ? 1 : 0}`];
    for (const t of ts) {
      pts.push(`${n(Math.max(t, eps))} ${on ? 1 : 0}`);
      on = !on;
      pts.push(`${n(Math.max(t, eps) + eps)} ${on ? 1 : 0}`);
    }
    lines.push(`${name} ${name}_n 0 ${ts.length ? `PWL(${pts.join(' ')})` : `DC ${on ? 1 : 0}`}`);
    models.add(`.model SWDL SW(VT=0.5 VH=0 RON=${n(R_ON)} ROFF=${n(R_OFF)})`);
    return `${name}_n`;
  };

  for (const e of nl.elements) {
    const [a, b, c] = e.nodes.map(node);
    const p = e.params;
    const ref = p.ctrl?.ref ? byId.get(p.ctrl.ref) : undefined;
    switch (e.type) {
      case 'R':
        lines.push(`${nm('R', e.id)} ${a} ${tail(e)} ${n(Number(p.value))}`);
        break;
      case 'C':
      case 'L': {
        const manual = (p.init ?? (hasSwitch ? 'auto' : 'manual')) === 'manual';
        const ic = e.type === 'C' ? Number(p.v0 ?? 0) : Number(p.i0 ?? 0);
        if (manual) needUic = true;
        lines.push(`${nm(e.type, e.id)} ${a} ${tail(e)} ${n(Number(p.value))}${manual ? ` IC=${n(ic)}` : ''}`);
        break;
      }
      case 'V':
      case 'I':
        lines.push(`${nm(e.type, e.id)} ${a} ${tail(e)} ${srcSpec(p)}`);
        break;
      case 'TS':
        lines.push(`${nm('I', e.id)} ${a} ${tail(e)} DC ${n(Number(p.kT ?? 1e-6) * (Number(p.tempC ?? 25) + 273.15))} ; sıcaklık sensörü I = k·T`);
        break;
      case 'AM':
        if (p.real) {
          lines.push(`${nm('R', e.id)} ${a} ${e.id}_m ${n(Number(p.rMeter ?? 1))} ; ampermetre iç direnci`);
          lines.push(`${nm('V', e.id)} ${e.id}_m ${b} DC 0 ; ampermetre`);
        } else lines.push(`${nm('V', e.id)} ${a} ${b} DC 0 ; ampermetre`);
        break;
      case 'VM':
        if (p.real) lines.push(`${nm('R', e.id)} ${a} ${tail(e)} ${n(Number(p.rMeter ?? 10e6))} ; voltmetre iç direnci`);
        else lines.push(`* ${e.id}: voltmetre, düğüm ${a} – ${b}`);
        break;
      case 'POT': {
        const { top, bottom } = potParts(e);
        lines.push(`${nm('R', e.id)}A ${a} ${c} ${n(top)} ; potansiyometre üst parça`, `${nm('R', e.id)}B ${c} ${b} ${n(bottom)} ; potansiyometre alt parça`);
        break;
      }
      case 'SW': {
        const ctl = switchCtl(`V${e.id}_c`, (p.sw0 ?? 'open') === 'closed', p.times ?? []);
        lines.push(`${nm('S', e.id)} ${a} ${b} ${ctl} 0 SWDL ; zamanlı anahtar`);
        break;
      }
      case 'SW2': {
        // kontrol 1 V → ortak uç A'da; B anahtarı ters kontrolle
        const ctl = switchCtl(`V${e.id}_c`, (p.way ?? 'A') === 'A', p.times ?? []);
        lines.push(`${nm('S', e.id)}A ${a} ${b} ${ctl} 0 SWDL ; iki yollu anahtar, A konumu`);
        lines.push(`${nm('S', e.id)}B ${a} ${c} 0 ${ctl} SWDLN ; iki yollu anahtar, B konumu`);
        models.add(`.model SWDLN SW(VT=-0.5 VH=0 RON=${n(R_ON)} ROFF=${n(R_OFF)})`);
        break;
      }
      case 'OA': {
        const [pp, nn, o] = [a, b, c];
        const model = p.model ?? 'ideal';
        if (model === 'finite') {
          lines.push(`${nm('R', e.id)}IN ${pp} ${nn} ${n(Number(p.rin ?? 1e6))} ; op-amp giriş direnci`);
          lines.push(`${nm('E', e.id)} ${e.id}_o 0 ${pp} ${nn} ${n(Number(p.gainA ?? 1e5))} ; op-amp, sonlu kazanç`);
          lines.push(`${nm('R', e.id)}OUT ${e.id}_o ${o} ${n(Number(p.rout ?? 100))} ; op-amp çıkış direnci`);
        } else if (model === 'offset') {
          lines.push(`${nm('V', e.id)}OS ${e.id}_p ${pp} DC ${n(Number(p.vos ?? 5e-3))} ; ofset gerilimi`);
          lines.push(`${nm('I', e.id)}BP ${pp} 0 DC ${n(Number(p.ib ?? 500e-9))} ; öngerilim akımı`);
          lines.push(`${nm('I', e.id)}BN ${nn} 0 DC ${n(Number(p.ib ?? 500e-9))} ; öngerilim akımı`);
          lines.push(`${nm('E', e.id)} ${o} 0 ${e.id}_p ${nn} 1e9 ; ideal op-amp (çok büyük kazanç)`);
        } else lines.push(`${nm('E', e.id)} ${o} 0 ${pp} ${nn} 1e9 ; ideal op-amp (çok büyük kazanç)`);
        break;
      }
      case 'E':
      case 'G':
        if (ref) lines.push(`${nm(e.type, e.id)} ${a} ${tail(e)} ${node(ref.nodes[0])} ${node(ref.nodes[1])} ${n(Number(p.gain))}`);
        else lines.push(`* ${e.id}: kontrol bileşeni seçilmemiş`);
        break;
      case 'F':
      case 'H':
        if (!ref) {
          lines.push(`* ${e.id}: kontrol bileşeni seçilmemiş`);
          break;
        }
        if (ref.type === 'R') {
          // direnç akımı = v_R / R → gerilim kontrolüne çevrilir
          const g = Number(p.gain) / Number(ref.params.value);
          lines.push(`${e.type === 'F' ? 'G' : 'E'}${e.id} ${a} ${tail(e)} ${node(ref.nodes[0])} ${node(ref.nodes[1])} ${n(g)} ; ${e.id} = ${n(Number(p.gain))}·i(${ref.id})`);
        } else lines.push(`${nm(e.type, e.id)} ${a} ${tail(e)} ${senseOf.get(ref.id)} ${n(Number(p.gain))}`);
        break;
    }
  }
  lines.push(...models);
  const an = opt.analysis;
  if (an?.type === 'ac') {
    const f = an.freq ?? Number(nl.elements.find((e) => (e.type === 'V' || e.type === 'I') && e.params.mode === 'AC')?.params.freq ?? 1000);
    lines.push(an.sweep ? `.ac dec ${an.pointsPerDecade} ${n(an.fStart)} ${n(an.fStop)}` : `.ac lin 1 ${n(f)} ${n(f)}`);
  } else if (an?.type === 'transient') {
    const tStop = opt.tStop ?? an.tStop ?? 10e-3;
    const h = opt.h ?? an.h ?? tStop / 1000;
    lines.push(`.tran ${n(h)} ${n(tStop)} 0 ${n(h)}${needUic ? ' uic' : ''}`);
  } else {
    lines.push('.op');
    if (needUic) lines.push('* Geçici rejim için: .tran <adım> <süre> uic (elle verilen başlangıç koşulları IC= ile yazıldı)');
  }
  lines.push('.end');
  return lines.join('\n');
}
