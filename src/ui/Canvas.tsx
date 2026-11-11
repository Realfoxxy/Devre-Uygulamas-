// SVG çizim alanı: yerleştirme, sürükleme, kablo çizme, seçim, kaydırma ve yakınlaştırma.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Component, CompType, PARTS, Pt, onSegment, pinPositions, samePt } from '../core/circuit';
import { isStale, useStore } from '../state/store';
import { G, PartSymbol, Theme } from './parts/symbols';
import { Schematic, SEL_COLOR } from './Schematic';
import { compDisplay } from './values';

const SCREEN_THEME: Theme = {
  stroke: '#1d2433',
  fill: '#ffffff',
  label: '#1d2433',
  value: '#2149b8',
  muted: '#8a93a3',
  font: 'DejaVuSans, Segoe UI, system-ui, sans-serif',
};

/** Palet ve klavye kısayolları için çizim alanına dışarıdan erişim */
export const canvasApi: {
  placeAtClient?: (type: CompType, rot: number, clientX: number, clientY: number) => boolean;
  ghostAtClient?: (clientX: number, clientY: number) => void;
  fit?: () => void;
  svg?: SVGSVGElement | null;
} = {};

interface View {
  x: number;
  y: number;
  k: number;
}

type Drag =
  | { kind: 'comp'; id: string; start: Pt; orig: Pt; ends: { wireId: string; end: 'from' | 'to'; dx: number; dy: number }[]; began: boolean }
  | { kind: 'pan'; sx: number; sy: number; orig: View }
  | { kind: 'wire'; start: Pt }
  | null;

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, k: 1 });
  const [hover, setHover] = useState<Pt | null>(null);
  const [wireStart, setWireStart] = useState<Pt | null>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<Drag>(null);
  /** Son basılan bileşen (pointer capture yüzünden dblclick hedefi SVG olur) */
  const lastDownComp = useRef<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; view: View; cx: number; cy: number } | null>(null);

  const s = useStore();
  const { components, wires } = s.doc;
  const stale = isStale(s);
  const errorIds = useMemo(() => new Set(s.issues.flatMap((i) => (i.level === 'error' ? i.compIds : []))), [s.issues]);

  const toGrid = useCallback(
    (clientX: number, clientY: number): Pt => {
      const r = svgRef.current!.getBoundingClientRect();
      return [(clientX - r.left - view.x) / view.k / G, (clientY - r.top - view.y) / view.k / G];
    },
    [view],
  );
  const snapPt = (p: Pt): Pt => [Math.round(p[0]), Math.round(p[1])];

  // Bağlantı noktası mı? (pin, kablo ucu ya da kablo üstü)
  const isConnection = useCallback(
    (p: Pt) =>
      components.some((c) => pinPositions(c).some((q) => samePt(q, p))) ||
      wires.some((w) => onSegment(p, w.from, w.to)),
    [components, wires],
  );

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || (!components.length && !wires.length)) {
      setView({ x: 40, y: 40, k: 1 });
      return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x: number, y: number) => {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    };
    components.forEach((c) => { add(c.x - 3, c.y - 3); add(c.x + 4, c.y + 3); });
    wires.forEach((w) => { add(...w.from); add(...w.to); });
    const r = svg.getBoundingClientRect();
    const wpx = (x1 - x0) * G;
    const hpx = (y1 - y0) * G;
    const k = Math.max(0.3, Math.min(1.6, Math.min(r.width / (wpx + 80), r.height / (hpx + 80))));
    setView({ k, x: r.width / 2 - ((x0 + x1) / 2) * G * k, y: r.height / 2 - ((y0 + y1) / 2) * G * k });
  }, [components, wires]);

  useEffect(() => {
    canvasApi.svg = svgRef.current;
    canvasApi.fit = fit;
    canvasApi.ghostAtClient = (cx, cy) => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return;
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) setHover(null);
      else setHover(snapPt(toGrid(cx, cy)));
    };
    canvasApi.placeAtClient = (type, rot, cx, cy) => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r || cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return false;
      const p = snapPt(toGrid(cx, cy));
      useStore.getState().addComponent(type, p[0], p[1], rot);
      return true;
    };
  }, [fit, toGrid]);

  // Tarayıcıdaki taslak açılışta yüklendiyse ona sığdır (sonraki eklemelerde görünüm kaymaz)
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    if (useStore.getState().doc.components.length) requestAnimationFrame(() => fitRef.current());
  }, []);
  useEffect(() => {
    const h = () => fit();
    window.addEventListener('devre:fit', h);
    return () => window.removeEventListener('devre:fit', h);
  }, [fit]);

  // Esc ile kabloyu iptal et
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWireStart(null);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => {
    if (s.tool === 'select' && !drag.current) setWireStart(null);
  }, [s.tool]);

  const finishWireAt = (p: Pt) => {
    if (!wireStart) return;
    if (samePt(p, wireStart)) return;
    const corner: Pt = [p[0], wireStart[1]];
    s.addWires([
      [wireStart, corner],
      [corner, p],
    ]);
    // bir bağlantı noktasında bittiyse kabloyu kapat, değilse devam et
    if (isConnection(p)) setWireStart(null);
    else setWireStart(p);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), view, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      drag.current = null;
      return;
    }
    if (e.button === 2) return;
    const p = snapPt(toGrid(e.clientX, e.clientY));
    const target = e.target as Element;
    const pinEl = target.closest('[data-pin]');
    const compEl = target.closest('[data-comp]');
    const wireEl = target.closest('[data-wire]');
    lastDownComp.current = compEl && !pinEl ? compEl.getAttribute('data-comp') : null;

    if (s.placing) {
      s.addComponent(s.placing.type, p[0], p[1], s.placing.rot);
      if (!e.shiftKey) s.setPlacing(null);
      return;
    }

    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);

    if (s.tool === 'wire' || pinEl || wireStart) {
      if (wireStart) {
        finishWireAt(p);
      } else {
        setWireStart(p);
        drag.current = { kind: 'wire', start: p };
      }
      return;
    }

    if (compEl) {
      const id = compEl.getAttribute('data-comp')!;
      const c = components.find((cc) => cc.id === id)!;
      s.select({ kind: 'comp', id });
      const pins = pinPositions(c);
      const ends: NonNullable<Extract<Drag, { kind: 'comp' }>['ends']> = [];
      for (const w of wires) {
        for (const end of ['from', 'to'] as const) {
          const pin = pins.find((q) => samePt(q, w[end]));
          if (pin) ends.push({ wireId: w.id, end, dx: pin[0] - c.x, dy: pin[1] - c.y });
        }
      }
      drag.current = { kind: 'comp', id, start: p, orig: [c.x, c.y], ends, began: false };
      return;
    }
    if (wireEl) {
      s.select({ kind: 'wire', id: wireEl.getAttribute('data-wire')! });
      return;
    }
    s.select(null);
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, orig: view };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const pv = pinch.current.view;
      const k = Math.max(0.25, Math.min(3, (pv.k * d) / pinch.current.d));
      const r = svgRef.current!.getBoundingClientRect();
      const cx = pinch.current.cx - r.left;
      const cy = pinch.current.cy - r.top;
      setView({ k, x: cx - ((cx - pv.x) * k) / pv.k, y: cy - ((cy - pv.y) * k) / pv.k });
      return;
    }
    const raw = toGrid(e.clientX, e.clientY);
    const p = snapPt(raw);
    if (!hover || !samePt(hover, p)) setHover(p);
    const d = drag.current;
    if (d?.kind === 'comp') {
      const dx = p[0] - d.start[0];
      const dy = p[1] - d.start[1];
      if (!d.began && (dx || dy)) {
        d.began = true;
        s.beginChange();
      }
      if (d.began) s.moveComponent(d.id, d.orig[0] + dx, d.orig[1] + dy, d.ends);
      setTip(null);
    } else if (d?.kind === 'pan') {
      setView({ ...d.orig, x: d.orig.x + e.clientX - d.sx, y: d.orig.y + e.clientY - d.sy });
    } else if (!d) {
      // ipucu
      const compEl = (e.target as Element).closest('[data-comp]');
      if (compEl && s.results && e.pointerType === 'mouse') {
        const r = svgRef.current!.getBoundingClientRect();
        setTip({ id: compEl.getAttribute('data-comp')!, x: e.clientX - r.left, y: e.clientY - r.top });
      } else if (tip) setTip(null);
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'wire') {
      const p = snapPt(toGrid(e.clientX, e.clientY));
      if (!samePt(p, d.start)) {
        // pinden sürükleyerek çizildi: tek hamlede bitir
        const corner: Pt = [p[0], d.start[1]];
        s.addWires([
          [d.start, corner],
          [corner, p],
        ]);
        setWireStart(isConnection(p) ? null : p);
      }
    }
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const k = Math.max(0.25, Math.min(3, view.k * Math.exp(-e.deltaY * 0.0015)));
    setView({ k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const id = (e.target as Element).closest('[data-comp]')?.getAttribute('data-comp') ?? lastDownComp.current;
    if (id && components.some((c) => c.id === id)) {
      s.select({ kind: 'comp', id });
      // panel yeniden çizildikten sonra değer kutusuna odaklan
      setTimeout(() => window.dispatchEvent(new CustomEvent('devre:edit-value')), 30);
    } else if (wireStart) setWireStart(null);
  };

  const zoomBy = (f: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const cx = r.width / 2;
    const cy = r.height / 2;
    const k = Math.max(0.25, Math.min(3, view.k * f));
    setView({ k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k });
  };

  const selectedComp = s.selection?.kind === 'comp' ? s.selection.id : null;
  const tipComp = tip ? components.find((c) => c.id === tip.id) : null;
  const tipData = tipComp && s.results ? compDisplay(s.results, tipComp.id, tipComp.type, s.tIndex, s.doc.analysis.acMeasure) : null;
  const ghost: Component | null =
    s.placing && hover ? { id: '_ghost', type: s.placing.type, x: hover[0], y: hover[1], rot: s.placing.rot, params: PARTS[s.placing.type].defaultParams } : null;
  const wireTarget = wireStart && hover ? hover : null;
  const hoveringConn = (s.tool === 'wire' || wireStart) && hover && isConnection(hover);
  const gridSize = G * view.k;

  return (
    <div className={`canvas-wrap ${s.tool === 'wire' || wireStart ? 'mode-wire' : ''} ${s.placing ? 'mode-place' : ''}`}>
      <svg
        ref={svgRef}
        className="canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          setTip(null);
          if (!drag.current && !s.placing) setHover(null);
        }}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          setWireStart(null);
          if (s.placing) s.setPlacing(null);
        }}
      >
        <defs>
          <pattern id="grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse" x={view.x % gridSize} y={view.y % gridSize}>
            <circle cx={0.5} cy={0.5} r={Math.max(0.8, view.k)} fill="#c9d0db" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <Schematic
            components={components}
            wires={wires}
            theme={SCREEN_THEME}
            results={s.results}
            netlist={s.resultsNetlist}
            tIndex={s.tIndex}
            stale={stale}
            showNodeLabels={s.showNodeLabels}
            errorIds={errorIds}
            selectedComp={selectedComp}
            selectedWire={s.selection?.kind === 'wire' ? s.selection.id : null}
            arrowFor={selectedComp}
            acMeasure={s.doc.analysis.acMeasure}
            interactive
          />
          {/* pinler */}
          {components.map((c) =>
            pinPositions(c).map((p, i) => (
              <g key={`${c.id}-${i}`} data-pin={`${c.id}:${i}`} className="pin">
                <circle cx={p[0] * G} cy={p[1] * G} r={9} fill="transparent" />
                <circle cx={p[0] * G} cy={p[1] * G} r={3.2} className="pin-dot" />
              </g>
            )),
          )}
          {/* kablo önizleme */}
          {wireStart && wireTarget && (
            <polyline
              points={`${wireStart[0] * G},${wireStart[1] * G} ${wireTarget[0] * G},${wireStart[1] * G} ${wireTarget[0] * G},${wireTarget[1] * G}`}
              fill="none"
              stroke={SEL_COLOR}
              strokeWidth={2}
              strokeDasharray="6 4"
              pointerEvents="none"
            />
          )}
          {wireStart && <circle cx={wireStart[0] * G} cy={wireStart[1] * G} r={5} fill={SEL_COLOR} pointerEvents="none" />}
          {(s.tool === 'wire' || wireStart) && hover && (
            <circle
              cx={hover[0] * G}
              cy={hover[1] * G}
              r={hoveringConn ? 7 : 4}
              fill="none"
              stroke={hoveringConn ? '#16a34a' : SEL_COLOR}
              strokeWidth={2}
              pointerEvents="none"
            />
          )}
          {ghost && (
            <g pointerEvents="none">
              <PartSymbol comp={ghost} theme={SCREEN_THEME} stroke={SEL_COLOR} opacity={0.6} />
            </g>
          )}
        </g>
      </svg>

      {stale && (
        <div className="stale-banner">Sonuçlar güncel değil — devre değişti. Yeniden çalıştırın.</div>
      )}
      {components.length === 0 && (
        <div className="empty-hint">
          <strong>Devrenizi kurun</strong>
          <span>Paletten bileşenleri sürükleyin ya da seçip çizim alanına dokunarak yerleştirin.</span>
          <span>Pinden sürükleyerek veya <kbd>W</kbd> ile kablo çizin. <kbd>R</kbd> döndürür.</span>
          <span>En az bir <b>toprak (GND)</b> ekleyip <b>Çalıştır</b>'a basın.</span>
          <button className="btn" onClick={() => window.dispatchEvent(new CustomEvent('devre:examples'))}>
            Örnek devre aç
          </button>
        </div>
      )}
      {tip && tipData && tipComp && (
        <div className="tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <b>{tipComp.id}</b>
          {tipData.rows.slice(0, 4).map((r) => (
            <div key={r.label}>
              <span>{r.label}</span> {r.value}
            </div>
          ))}
        </div>
      )}
      <div className="zoom-ctl">
        <button title="Yakınlaştır" onClick={() => zoomBy(1.2)}>+</button>
        <button title="Uzaklaştır" onClick={() => zoomBy(1 / 1.2)}>−</button>
        <button title="Devreyi sığdır" onClick={fit}>⤢</button>
      </div>
      {(s.placing || s.tool === 'wire' || wireStart) && (
        <div className="mode-hint">
          {s.placing
            ? `${PARTS[s.placing.type].name}: yerleştirmek için tıklayın · R: döndür · Esc: iptal`
            : wireStart
              ? 'Kablo: bitirmek için bir pine / kabloya tıklayın · çift tık ya da Esc: bitir'
              : 'Kablo modu: başlangıç noktasına tıklayın · W / Esc: çık'}
        </div>
      )}
    </div>
  );
}
