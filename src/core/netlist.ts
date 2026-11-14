// Çizimden çözücüye köprü: union-find (ayrık kümeler) ile düğümleri bulur
// ve çözümden önce yaygın hataları yakalar.
import {
  Component,
  CompType,
  ctrlKindOf,
  Params,
  Pt,
  Wire,
  onSegment,
  pinPositions,
  ptKey,
} from './circuit';
import { formatEng } from './units';

export interface NetElement {
  id: string;
  type: Exclude<CompType, 'GND'>;
  /** Pin düğümleri (iki uçlularda [düğüm+, düğüm−]; üç uçlularda pin sırasıyla); 0 = toprak */
  nodes: number[];
  params: Params;
}

export interface Issue {
  level: 'error' | 'warning';
  message: string;
  compIds: string[];
}

export interface Netlist {
  elements: NetElement[];
  /** Toprak hariç düğüm sayısı (düğümler 1..nodeCount) */
  nodeCount: number;
  /** Her bileşenin pin düğümleri */
  pinNodes: Record<string, number[]>;
  /** Her kablonun düğümü */
  wireNodes: Record<string, number>;
  /** Düğüm etiketi için çizim üzerindeki konum */
  nodeAnchors: Pt[];
  issues: Issue[];
}

class UnionFind {
  parent = new Map<string, string>();
  find(a: string): string {
    if (!this.parent.has(a)) this.parent.set(a, a);
    let r = a;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    // yol sıkıştırma
    let x = a;
    while (this.parent.get(x) !== r) {
      const nx = this.parent.get(x)!;
      this.parent.set(x, r);
      x = nx;
    }
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export function buildNetlist(components: Component[], wires: Wire[]): Netlist {
  const uf = new UnionFind();
  const issues: Issue[] = [];

  // 1) Her pin ve kablo ucu ızgara noktasıyla anahtarlanır: aynı noktadaki
  //    tüm uçlar otomatik olarak aynı kümededir.
  const pins: Record<string, Pt[]> = {};
  for (const c of components) {
    const ps = pinPositions(c);
    pins[c.id] = ps;
    for (const p of ps) {
      uf.find(ptKey(p));
    }
  }
  // 2) Her kablonun iki ucu birleştirilir.
  for (const w of wires) {
    uf.union(ptKey(w.from), ptKey(w.to));
  }
  // 3) Bir kablonun UCU başka bir kablonun ortasına denk gelirse (T bağlantısı) birleşir.
  //    Kablonun üstünden geçtiği pinler ise bağlanmaz: bir pine bağlanmak için kablonun
  //    o pinde bitmesi gerekir.
  const wireEnds = new Map<string, Pt>();
  for (const w of wires) {
    wireEnds.set(ptKey(w.from), w.from);
    wireEnds.set(ptKey(w.to), w.to);
  }
  for (const w of wires) {
    for (const [k, p] of wireEnds) {
      if (onSegment(p, w.from, w.to)) uf.union(k, ptKey(w.from));
    }
  }

  // 4) Kümelere düğüm numarası ver: GND içeren küme 0.
  const grounds = components.filter((c) => c.type === 'GND');
  const rootToNode = new Map<string, number>();
  for (const g of grounds) rootToNode.set(uf.find(ptKey(pins[g.id][0])), 0);
  let next = 1;
  const pinNodes: Record<string, number[]> = {};
  for (const c of components) {
    pinNodes[c.id] = pins[c.id].map((p) => {
      const r = uf.find(ptKey(p));
      if (!rootToNode.has(r)) rootToNode.set(r, next++);
      return rootToNode.get(r)!;
    });
  }
  const wireNodes: Record<string, number> = {};
  for (const w of wires) {
    const r = uf.find(ptKey(w.from));
    if (!rootToNode.has(r)) rootToNode.set(r, -1); // hiçbir pine bağlı olmayan kablo
    wireNodes[w.id] = rootToNode.get(r)!;
  }
  const nodeCount = next - 1;

  // Düğüm etiket konumu: düğümdeki en uzun kablonun ortası, yoksa ilk pin.
  const nodeAnchors: Pt[] = new Array(nodeCount + 1);
  const best: number[] = new Array(nodeCount + 1).fill(-1);
  for (const w of wires) {
    const n = wireNodes[w.id];
    if (n < 0) continue;
    const len = Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]);
    if (len > best[n]) {
      best[n] = len;
      nodeAnchors[n] = [(w.from[0] + w.to[0]) / 2, (w.from[1] + w.to[1]) / 2];
    }
  }
  for (const c of components) {
    pinNodes[c.id].forEach((n, i) => {
      if (!nodeAnchors[n]) nodeAnchors[n] = pins[c.id][i];
    });
  }

  // Doğrulama: toprak yok
  const elements: NetElement[] = [];
  for (const c of components) {
    if (c.type === 'GND') continue;
    const n = pinNodes[c.id];
    elements.push({ id: c.id, type: c.type, nodes: [...n], params: { ...c.params } });
  }
  if (elements.length === 0) {
    issues.push({ level: 'error', message: 'Devre boş: önce bileşen ekleyin.', compIds: [] });
  }
  if (grounds.length === 0 && elements.length > 0) {
    issues.push({
      level: 'error',
      message: 'Toprak yok: devreye en az bir toprak (GND) bileşeni ekleyin.',
      compIds: [],
    });
  }

  // Doğrulama: boştaki uç (düğümde tek pin var)
  const pinCount = new Map<number, number>();
  for (const c of components) for (const n of pinNodes[c.id]) pinCount.set(n, (pinCount.get(n) ?? 0) + 1);
  const floating: string[] = [];
  for (const c of components) {
    if (c.type === 'GND') continue;
    if (pinNodes[c.id].some((n) => pinCount.get(n) === 1)) floating.push(c.id);
  }
  if (floating.length) {
    issues.push({
      level: 'error',
      message: `Boştaki uç: ${floating.join(', ')} bileşeninin bir ucu hiçbir şeye bağlı değil.`,
      compIds: floating,
    });
  }
  if (grounds.length > 0 && elements.length > 0 && (pinCount.get(0) ?? 0) === grounds.length) {
    issues.push({
      level: 'error',
      message: 'Toprak bileşeni devreye bağlı değil: GND ucunu bir kabloyla devreye bağlayın.',
      compIds: grounds.map((g) => g.id),
    });
  }

  // Doğrulama: parametreler
  for (const e of elements) {
    if (e.type === 'R' || e.type === 'C' || e.type === 'L') {
      const v = Number(e.params.value);
      const what = e.type === 'R' ? 'direnç' : e.type === 'C' ? 'kapasitans' : 'indüktans';
      if (!(v > 0) || !Number.isFinite(v)) {
        issues.push({ level: 'error', message: `${e.id}: ${what} değeri sıfırdan büyük olmalı.`, compIds: [e.id] });
      } else if (v < 1e-15 || v > 1e12) {
        issues.push({
          level: 'warning',
          message: `${e.id}: ${what} değeri (${v.toExponential(2)}) çok ${v < 1e-15 ? 'küçük' : 'büyük'}; sonuçlar sayısal olarak hatalı olabilir.`,
          compIds: [e.id],
        });
      }
    }
    if ((e.type === 'V' || e.type === 'I') && e.params.mode === 'AC' && !(Number(e.params.freq) > 0)) {
      issues.push({ level: 'error', message: `${e.id}: AC frekansı sıfırdan büyük olmalı.`, compIds: [e.id] });
    }
  }

  return { elements, nodeCount, pinNodes, wireNodes, nodeAnchors, issues };
}

/** Bileşen değerinin kısa yazımı: "1 kΩ", "AC 5 V 1 kHz" … */
export function describeValue(type: CompType, p: Params): string {
  switch (type) {
    case 'R':
      return formatEng(p.value ?? 0, 'Ω');
    case 'C':
      return formatEng(p.value ?? 0, 'F');
    case 'L':
      return formatEng(p.value ?? 0, 'H');
    case 'V':
    case 'I': {
      const u = type === 'V' ? 'V' : 'A';
      if (p.mode === 'AC') {
        const ph = p.phase ? ` ∠${+(p.phase ?? 0).toFixed(1)}°` : '';
        return `${formatEng(p.amp ?? 0, u)}${ph} ~ ${formatEng(p.freq ?? 0, 'Hz')}`;
      }
      return `${formatEng(p.value ?? 0, u)} DC`;
    }
    case 'E':
    case 'F':
    case 'G':
    case 'H': {
      const g = Number(p.gain ?? 0);
      const k = ctrlKindOf(type);
      const ref = p.ctrl?.ref ?? '?';
      const gs = type === 'H' ? formatEng(g, 'Ω').replace(' ', '') : type === 'G' ? formatEng(g, 'S').replace(' ', '') : String(parseFloat(g.toPrecision(4)));
      return `${gs}·${k === 'V' ? 'v' : 'i'}(${ref})`;
    }
    case 'VM':
      return 'voltmetre';
    case 'AM':
      return 'ampermetre';
    default:
      return '';
  }
}

/** Metin netlist (Çözümü göster ve PDF eki için). */
export function netlistText(nl: Netlist): string {
  return nl.elements
    .map((e) => {
      const p = e.params;
      let val = '';
      switch (e.type) {
        case 'R':
        case 'C':
        case 'L':
          val = String(p.value);
          if (e.type === 'C' && p.v0) val += ` IC=${p.v0}`;
          if (e.type === 'L' && p.i0) val += ` IC=${p.i0}`;
          break;
        case 'V':
        case 'I':
          val = p.mode === 'AC' ? `AC ${p.amp} ${p.freq}Hz ${p.phase ?? 0}°` : `DC ${p.value}`;
          break;
        case 'E':
        case 'F':
        case 'G':
        case 'H':
          val = describeValue(e.type, p);
          break;
        case 'VM':
          val = '(voltmetre)';
          break;
        case 'AM':
          val = '(ampermetre)';
          break;
      }
      return `${e.id.padEnd(5)} ${e.nodes.map((n) => String(n).padStart(2)).join(' ')}  ${val}`;
    })
    .join('\n');
}
