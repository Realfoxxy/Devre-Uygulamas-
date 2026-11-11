// Devre şeması: hem etkileşimli çizim alanında hem de PDF / SVG dışa aktarımında kullanılır.
import { Component, Pt, Wire, onSegment, pinPositions, ptKey } from '../core/circuit';
import type { Netlist } from '../core/netlist';
import type { AnalysisResult } from '../core/results';
import { G, PartLabel, PartSymbol, Theme } from './parts/symbols';
import { compDisplay, nodeText } from './values';

export const SEL_COLOR = '#2557d6';
export const ERR_COLOR = '#d92d20';
export const CURRENT_COLOR = '#c2410c';
export const NODE_COLOR = '#0f766e';

export interface SchematicProps {
  components: Component[];
  wires: Wire[];
  theme: Theme;
  results?: AnalysisResult | null;
  netlist?: Netlist | null;
  tIndex?: number | null;
  stale?: boolean;
  showNodeLabels?: boolean;
  errorIds?: Set<string>;
  selectedComp?: string | null;
  selectedWire?: string | null;
  /** Çoklu seçim */
  selectedComps?: Set<string>;
  selectedWires?: Set<string>;
  arrowFor?: string | null;
  interactive?: boolean;
  acMeasure?: 'rms' | 'peak';
}

export function junctionPoints(components: Component[], wires: Wire[]): Pt[] {
  const count = new Map<string, number>();
  const pts = new Map<string, Pt>();
  const bump = (p: Pt, n = 1) => {
    const k = ptKey(p);
    pts.set(k, p);
    count.set(k, (count.get(k) ?? 0) + n);
  };
  for (const c of components) for (const p of pinPositions(c)) bump(p);
  for (const w of wires) {
    bump(w.from);
    bump(w.to);
  }
  const ends = new Set(wires.flatMap((w) => [ptKey(w.from), ptKey(w.to)]));
  for (const w of wires)
    for (const [k, p] of pts) {
      const isEnd = ptKey(w.from) === k || ptKey(w.to) === k;
      // yalnızca kablo ucu başka kablonun ortasına denk gelirse bağlantıdır (netlist ile aynı kural)
      if (!isEnd && ends.has(k) && onSegment(p, w.from, w.to)) count.set(k, (count.get(k) ?? 0) + 2);
    }
  return [...pts.entries()].filter(([k]) => (count.get(k) ?? 0) >= 3).map(([, p]) => p);
}

function CurrentArrow({ comp, sign }: { comp: Component; sign: number }) {
  if (comp.type === 'GND') return null;
  const [p0, p1] = pinPositions(comp).map(([x, y]) => [x * G, y * G]);
  const dir = sign < 0 ? -1 : 1;
  const [ax, ay] = [p1[0] - p0[0], p1[1] - p0[1]];
  const len = Math.hypot(ax, ay);
  const ux = ax / len;
  const uy = ay / len;
  // etiketin karşı tarafına kaydır: yatayda alta, dikeyde sola
  const off = 22;
  const vert = comp.rot % 180 !== 0;
  const nx = vert ? -off : 0;
  const ny = vert ? 0 : off;
  const mx = (p0[0] + p1[0]) / 2 + nx;
  const my = (p0[1] + p1[1]) / 2 + ny;
  const half = 16;
  const sx = mx - ux * half * dir;
  const sy = my - uy * half * dir;
  const ex = mx + ux * half * dir;
  const ey = my + uy * half * dir;
  const hx = ux * dir;
  const hy = uy * dir;
  const head = `${ex},${ey} ${ex - hx * 8 - hy * 5},${ey - hy * 8 + hx * 5} ${ex - hx * 8 + hy * 5},${ey - hy * 8 - hx * 5}`;
  return (
    <g pointerEvents="none">
      <line x1={sx} y1={sy} x2={ex - hx * 4} y2={ey - hy * 4} stroke={CURRENT_COLOR} strokeWidth={2.2} />
      <polygon points={head} fill={CURRENT_COLOR} />
    </g>
  );
}

export function Schematic(p: SchematicProps) {
  const { components, wires, theme, results, netlist, interactive } = p;
  const junctions = junctionPoints(components, wires);
  const labelColor = p.stale ? '#9aa1ad' : NODE_COLOR;

  return (
    <g>
      {/* kablolar */}
      {wires.map((w) => {
        const sel = p.selectedWire === w.id || !!p.selectedWires?.has(w.id);
        return (
          <g key={w.id} data-wire={interactive ? w.id : undefined} className={interactive ? 'wire' : undefined}>
            {interactive && (
              <line x1={w.from[0] * G} y1={w.from[1] * G} x2={w.to[0] * G} y2={w.to[1] * G} stroke="transparent" strokeWidth={14} />
            )}
            <line
              x1={w.from[0] * G}
              y1={w.from[1] * G}
              x2={w.to[0] * G}
              y2={w.to[1] * G}
              stroke={sel ? SEL_COLOR : theme.stroke}
              strokeWidth={sel ? 3 : 2}
              strokeLinecap="round"
            />
          </g>
        );
      })}
      {junctions.map((j) => (
        <circle key={ptKey(j)} cx={j[0] * G} cy={j[1] * G} r={4} fill={theme.stroke} pointerEvents="none" />
      ))}

      {/* bileşenler */}
      {components.map((c) => {
        const err = p.errorIds?.has(c.id);
        const sel = p.selectedComp === c.id || !!p.selectedComps?.has(c.id);
        const color = err ? ERR_COLOR : sel ? SEL_COLOR : undefined;
        let extra: string | undefined;
        if (results && (c.type === 'VM' || c.type === 'AM' || (p.arrowFor === c.id && !p.stale))) {
          const d = compDisplay(results, c.id, c.type, p.tIndex ?? null, p.acMeasure ?? 'rms');
          if (d && c.type === 'VM') extra = d.rows.find((r) => r.label.startsWith('Gerilim'))?.value;
          else if (d && c.type === 'AM') extra = d.rows.find((r) => r.label.startsWith('Akım'))?.value;
          else if (d) extra = `I = ${d.currentText}`;
        }
        return (
          <g key={c.id} data-comp={interactive ? c.id : undefined} className={interactive ? 'comp' : undefined}>
            {interactive && (
              <g transform={`translate(${c.x * G} ${c.y * G}) rotate(${c.rot})`}>
                {c.type === 'GND' ? (
                  <rect x={-15} y={-2} width={30} height={26} fill="transparent" />
                ) : (
                  <rect x={-30} y={-18} width={60} height={36} fill="transparent" />
                )}
              </g>
            )}
            {sel && interactive && (
              <g transform={`translate(${c.x * G} ${c.y * G}) rotate(${c.rot})`}>
                {c.type === 'GND' ? (
                  <rect x={-18} y={-6} width={36} height={32} rx={6} fill="rgba(37,87,214,0.08)" stroke={SEL_COLOR} strokeDasharray="4 3" />
                ) : (
                  <rect x={-34} y={-21} width={68} height={42} rx={6} fill="rgba(37,87,214,0.08)" stroke={SEL_COLOR} strokeDasharray="4 3" />
                )}
              </g>
            )}
            <PartSymbol comp={c} theme={theme} stroke={color} />
            <PartLabel comp={c} theme={theme} extra={extra} extraColor={p.stale ? '#9aa1ad' : CURRENT_COLOR} />
          </g>
        );
      })}

      {/* seçili bileşenin akım yönü */}
      {results && p.arrowFor && !p.stale && (() => {
        const c = components.find((cc) => cc.id === p.arrowFor);
        if (!c || c.type === 'GND' || c.type === 'VM') return null;
        const d = compDisplay(results, c.id, c.type, p.tIndex ?? null, p.acMeasure ?? 'rms');
        if (!d) return null;
        return <CurrentArrow comp={c} sign={d.currentSign} />;
      })()}

      {/* düğüm gerilimleri */}
      {results && netlist && p.showNodeLabels &&
        placeNodeLabels(components, wires, netlist, (k) => `${k}: ${nodeText(results, k, p.tIndex ?? null)}`).map((l) => (
          <g key={`n${l.node}`} pointerEvents="none">
            <rect x={l.x} y={l.y} width={l.w} height={16} rx={8} fill="#ffffff" stroke={labelColor} strokeWidth={1} />
            <text x={l.x + l.w / 2} y={l.y + 8} fontSize={10.5} fontFamily="DejaVuSans, sans-serif" fill={labelColor} textAnchor="middle" dominantBaseline="central" fontWeight={700}>
              {l.text}
            </text>
          </g>
        ))}
      {/* toprak düğümü: 0 */}
    </g>
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Bileşen gövdesi ve etiketinin kapladığı alanlar (piksel) */
function obstacles(components: Component[]): Box[] {
  const out: Box[] = [];
  for (const c of components) {
    const cx = c.x * G;
    const cy = c.y * G;
    const vertical = c.rot % 180 !== 0;
    if (c.type === 'GND') {
      out.push({ x: cx - 14, y: cy - 2, w: 28, h: 26 });
      continue;
    }
    out.push(vertical ? { x: cx - 18, y: cy - 40, w: 36, h: 80 } : { x: cx - 40, y: cy - 18, w: 80, h: 36 });
    const value = c.type === 'VM' || c.type === 'AM' ? 1 : 2;
    const tw = 80;
    const th = value * 13 + 4;
    out.push(vertical ? { x: cx + 18, y: cy - th / 2, w: tw, h: th } : { x: cx - tw / 2, y: cy - 22 - th + 6, w: tw, h: th });
  }
  return out;
}

export interface NodeLabel {
  node: number;
  text: string;
  x: number;
  y: number;
  w: number;
}

/** Düğüm etiketlerini bileşenlerle ve birbirleriyle çakışmayacak şekilde yerleştirir. */
export function placeNodeLabels(components: Component[], wires: Wire[], nl: Netlist, text: (k: number) => string): NodeLabel[] {
  const obs = obstacles(components);
  const placed: Box[] = [];
  const out: NodeLabel[] = [];
  for (let k = 1; k <= nl.nodeCount; k++) {
    const t = text(k);
    const w = t.length * 6.4 + 10;
    const h = 16;
    const anchors: Pt[] = [];
    for (const wr of wires) {
      if (nl.wireNodes[wr.id] !== k) continue;
      anchors.push([(wr.from[0] + wr.to[0]) / 2, (wr.from[1] + wr.to[1]) / 2], wr.from, wr.to);
    }
    if (!anchors.length && nl.nodeAnchors[k]) anchors.push(nl.nodeAnchors[k]);
    if (!anchors.length) continue;
    let best: { box: Box; score: number; ax: number; ay: number } | null = null;
    anchors.forEach(([gx, gy], ai) => {
      const ax = gx * G;
      const ay = gy * G;
      const cands: [number, number, number][] = [
        [ax + 6, ay - h - 4, 0],
        [ax - w - 6, ay - h - 4, 0.5],
        [ax + 6, ay + 4, 0.5],
        [ax - w - 6, ay + 4, 0.8],
        [ax - w / 2, ay - h - 6, 0.3],
        [ax - w / 2, ay + 6, 0.6],
      ];
      for (const [x, y, pen] of cands) {
        const box = { x, y, w, h };
        let score = pen + ai * 0.01;
        for (const o of obs) score += overlap(box, o) * 2;
        for (const o of placed) score += overlap(box, o) * 4;
        if (!best || score < best.score) best = { box, score, ax, ay };
      }
    });
    if (!best) continue;
    const b = best as { box: Box; score: number; ax: number; ay: number };
    placed.push(b.box);
    out.push({ node: k, text: t, x: b.box.x, y: b.box.y, w });
  }
  return out;
}

/** Şemanın sınır kutusu (piksel) */
export function schematicBounds(components: Component[], wires: Wire[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const c of components) {
    for (const [x, y] of pinPositions(c)) add(x * G, y * G);
    const vertical = c.rot % 180 !== 0;
    if (c.type === 'GND') add(c.x * G, c.y * G + 24);
    else if (vertical) add(c.x * G + 100, c.y * G);
    else add(c.x * G, c.y * G - 52);
  }
  for (const w of wires) {
    add(w.from[0] * G, w.from[1] * G);
    add(w.to[0] * G, w.to[1] * G);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 400, h: 300 };
  const pad = 24;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}
