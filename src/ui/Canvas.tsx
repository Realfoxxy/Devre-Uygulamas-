// SVG çizim alanı: yerleştirme, sürükleme, kablo çizme, seçim, kaydırma ve yakınlaştırma.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Component, CompType, PARTS, Pt, ctrlKindOf, onSegment, pinPositions, ptKey, samePt } from '../core/circuit';
import { pathToSegments, routeWire } from '../core/route';
import { isStale, useStore } from '../state/store';
import { G, PartSymbol, Theme } from './parts/symbols';
import { Schematic, SEL_COLOR } from './Schematic';
import { compDisplay } from './values';
import { useMethods } from './useMethods';

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
  | {
      kind: 'group';
      start: Pt;
      comps: Record<string, Pt>;
      wires: Record<string, [Pt, Pt]>;
      ends: { wireId: string; end: 'from' | 'to'; orig: Pt }[];
      began: boolean;
    }
  | { kind: 'pan'; sx: number; sy: number; orig: View; button: number; moved: boolean }
  | { kind: 'box'; start: Pt; cur: Pt; add: boolean }
  | { kind: 'wirePending'; wireId: string; start: Pt; add: boolean }
  | { kind: 'wire'; start: Pt }
  | null;

/** Grid noktasını kablonun üzerine izdüşür (yatay / dikey kablolar). */
function projectOnWire(p: Pt, w: { from: Pt; to: Pt }): Pt {
  const [a, b] = [w.from, w.to];
  const clamp = (v: number, x: number, y: number) => Math.max(Math.min(x, y), Math.min(Math.max(x, y), v));
  if (a[1] === b[1]) return [clamp(p[0], a[0], b[0]), a[1]];
  if (a[0] === b[0]) return [a[0], clamp(p[1], a[1], b[1])];
  // çapraz kablo: en yakın uç
  return Math.hypot(p[0] - a[0], p[1] - a[1]) <= Math.hypot(p[0] - b[0], p[1] - b[1]) ? a : b;
}

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
  /** Sağ tuşla sürükleyip kaydırdıysa bağlam menüsü iptal işlemini yapmasın */
  const rightPanned = useRef(false);
  const [box, setBox] = useState<{ a: Pt; b: Pt } | null>(null);

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

  const route = useCallback(
    (a: Pt, b: Pt) => routeWire(a, b, components, wires, Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 'h' : 'v'),
    [components, wires],
  );

  const finishWireAt = (p: Pt) => {
    if (!wireStart) return;
    if (samePt(p, wireStart)) return;
    s.addWires(pathToSegments(route(wireStart, p)));
    // bir bağlantı noktasında bittiyse kabloyu kapat, değilse devam et
    if (isConnection(p)) setWireStart(null);
    else setWireStart(p);
  };

  /** Mevcut seçim (tekli ya da çoklu) kümeleri */
  const currentSets = () => {
    const st = useStore.getState();
    const comps = new Set(st.group?.comps ?? (st.selection?.kind === 'comp' ? [st.selection.id] : []));
    const ws = new Set(st.group?.wires ?? (st.selection?.kind === 'wire' ? [st.selection.id] : []));
    return { comps, ws };
  };

  const toggleInGroup = (kind: 'comp' | 'wire', id: string) => {
    const { comps, ws } = currentSets();
    const set = kind === 'comp' ? comps : ws;
    if (set.has(id)) set.delete(id);
    else set.add(id);
    s.setGroup({ comps: [...comps], wires: [...ws] });
  };

  /** Seçili bileşen ve kabloları birlikte taşımak için başlangıç durumu */
  const startGroupDrag = (p: Pt, compIds: Set<string>, wireIds: Set<string>) => {
    const comps: Record<string, Pt> = {};
    const pinKeys = new Set<string>();
    for (const c of components)
      if (compIds.has(c.id)) {
        comps[c.id] = [c.x, c.y];
        pinPositions(c).forEach((q) => pinKeys.add(ptKey(q)));
      }
    const ws: Record<string, [Pt, Pt]> = {};
    const ends: Extract<Drag, { kind: 'group' }>['ends'] = [];
    for (const w of wires) {
      if (wireIds.has(w.id)) ws[w.id] = [w.from, w.to];
      else
        for (const end of ['from', 'to'] as const) if (pinKeys.has(ptKey(w[end]))) ends.push({ wireId: w.id, end, orig: w[end] });
    }
    drag.current = { kind: 'group', start: p, comps, wires: ws, ends, began: false };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), view, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      drag.current = null;
      setBox(null);
      return;
    }
    // Sağ / orta tuş: haritayı kaydır
    if (e.button === 2 || e.button === 1) {
      e.preventDefault();
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      rightPanned.current = false;
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, orig: view, button: e.button, moved: false };
      return;
    }
    const raw = toGrid(e.clientX, e.clientY);
    const p = snapPt(raw);
    const target = e.target as Element;
    const pinEl = target.closest('[data-pin]');
    const compEl = target.closest('[data-comp]');
    const wireEl = target.closest('[data-wire]');
    lastDownComp.current = compEl && !pinEl ? compEl.getAttribute('data-comp') : null;

    // "Devreden seç": bağımlı kaynağın kontrol bileşenini seç
    if (s.pickCtrlFor) {
      const id = compEl?.getAttribute('data-comp');
      const dep = components.find((c) => c.id === s.pickCtrlFor);
      if (id && dep && id !== dep.id) {
        s.updateParams(dep.id, { ctrl: { ref: id, kind: ctrlKindOf(dep.type) } });
        s.select({ kind: 'comp', id: dep.id });
        s.setPickCtrl(null);
      } else if (!id) s.setPickCtrl(null);
      return;
    }

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
        // kablo modunda bir kablonun üstüne tıklandıysa nokta o kablonun üzerine oturur
        const w = wireEl ? wires.find((ww) => ww.id === wireEl.getAttribute('data-wire')) : undefined;
        const start = w && !pinEl ? projectOnWire(p, w) : p;
        setWireStart(start);
        drag.current = { kind: 'wire', start };
      }
      return;
    }

    const { comps: selC, ws: selW } = currentSets();
    const add = e.shiftKey || e.ctrlKey || e.metaKey;

    if (compEl) {
      const id = compEl.getAttribute('data-comp')!;
      if (add) {
        toggleInGroup('comp', id);
        return;
      }
      if (s.group && selC.has(id)) {
        startGroupDrag(p, selC, selW);
        return;
      }
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
      const id = wireEl.getAttribute('data-wire')!;
      if (add) {
        toggleInGroup('wire', id);
        return;
      }
      if (s.group && selW.has(id)) {
        startGroupDrag(p, selC, selW);
        return;
      }
      // Tıklama kabloyu seçer; sürükleme o noktadan yeni bir kablo başlatır (T bağlantısı)
      const w = wires.find((ww) => ww.id === id)!;
      drag.current = { kind: 'wirePending', wireId: id, start: projectOnWire(p, w), add };
      return;
    }
    // Boş alan: fareyle sürükleme alan seçer, dokunmatikte kaydırır
    if (e.pointerType === 'touch') {
      s.select(null);
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, orig: view, button: 0, moved: false };
      return;
    }
    if (!add) s.select(null);
    drag.current = { kind: 'box', start: raw, cur: raw, add };
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
    } else if (d?.kind === 'group') {
      const dx = p[0] - d.start[0];
      const dy = p[1] - d.start[1];
      if (!d.began && (dx || dy)) {
        d.began = true;
        s.beginChange();
      }
      if (d.began) {
        const cp: Record<string, Pt> = {};
        for (const [id, [x, y]] of Object.entries(d.comps)) cp[id] = [x + dx, y + dy];
        const wp: Record<string, { from?: Pt; to?: Pt }> = {};
        for (const [id, [a, b]] of Object.entries(d.wires)) wp[id] = { from: [a[0] + dx, a[1] + dy], to: [b[0] + dx, b[1] + dy] };
        for (const en of d.ends) (wp[en.wireId] ??= {})[en.end] = [en.orig[0] + dx, en.orig[1] + dy];
        s.setPositions(cp, wp);
      }
      setTip(null);
    } else if (d?.kind === 'pan') {
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) {
        d.moved = true;
        if (d.button === 2) rightPanned.current = true;
      }
      setView({ ...d.orig, x: d.orig.x + e.clientX - d.sx, y: d.orig.y + e.clientY - d.sy });
    } else if (d?.kind === 'box') {
      d.cur = raw;
      setBox({ a: d.start, b: raw });
    } else if (d?.kind === 'wirePending') {
      const w = wires.find((ww) => ww.id === d.wireId);
      if (w && !samePt(p, d.start)) {
        // sürükleme başladı: kablonun üzerindeki noktadan yeni kablo
        setWireStart(d.start);
        drag.current = { kind: 'wire', start: d.start };
      }
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
        // sürükleyerek çizildi: tek hamlede bitir
        s.addWires(pathToSegments(route(d.start, p)));
        setWireStart(isConnection(p) ? null : p);
      }
    } else if (d?.kind === 'wirePending') {
      s.select({ kind: 'wire', id: d.wireId });
    } else if (d?.kind === 'box') {
      setBox(null);
      const x0 = Math.min(d.start[0], d.cur[0]);
      const x1 = Math.max(d.start[0], d.cur[0]);
      const y0 = Math.min(d.start[1], d.cur[1]);
      const y1 = Math.max(d.start[1], d.cur[1]);
      if (x1 - x0 < 0.3 && y1 - y0 < 0.3) return; // sadece tıklama
      const inside = (q: Pt) => q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1;
      const comps = components.filter((c) => inside([c.x, c.y])).map((c) => c.id);
      const ws = wires.filter((w) => inside(w.from) && inside(w.to)).map((w) => w.id);
      if (d.add) {
        const cur = currentSets();
        comps.forEach((c) => cur.comps.add(c));
        ws.forEach((w) => cur.ws.add(w));
        s.setGroup({ comps: [...cur.comps], wires: [...cur.ws] });
      } else s.setGroup({ comps, wires: ws });
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
  const groupComps = useMemo(() => new Set(s.group?.comps ?? []), [s.group]);
  const highlightSet = useMemo(() => new Set(s.highlight), [s.highlight]);
  const methods = useMethods(s.solutionOpen && s.solutionTab !== 'mna');
  const groupWires = useMemo(() => new Set(s.group?.wires ?? []), [s.group]);
  const tipComp = tip ? components.find((c) => c.id === tip.id) : null;
  const tipData = tipComp && s.results ? compDisplay(s.results, tipComp.id, tipComp.type, s.tIndex, s.doc.analysis.acMeasure) : null;
  const ghost: Component | null =
    s.placing && hover ? { id: '_ghost', type: s.placing.type, x: hover[0], y: hover[1], rot: s.placing.rot, params: PARTS[s.placing.type].defaultParams } : null;
  const wireTarget = wireStart && hover ? hover : null;
  const previewPath = wireStart && wireTarget && !samePt(wireStart, wireTarget) ? route(wireStart, wireTarget) : null;
  // Hiçbir şeye bağlı olmayan pinler (kullanıcıya görsel uyarı)
  const openPins = useMemo(() => {
    const count = new Map<string, number>();
    const bump = (p: Pt) => count.set(ptKey(p), (count.get(ptKey(p)) ?? 0) + 1);
    components.forEach((c) => pinPositions(c).forEach(bump));
    wires.forEach((w) => {
      bump(w.from);
      bump(w.to);
    });
    return new Set([...count].filter(([, n]) => n === 1).map(([k]) => k));
  }, [components, wires]);
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
          if (rightPanned.current) {
            rightPanned.current = false;
            return;
          }
          // sağ tık (sürüklemeden): kabloyu / yerleştirmeyi iptal et
          setWireStart(null);
          if (s.placing) s.setPlacing(null);
        }}
        onAuxClick={(e) => e.preventDefault()}
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
            selectedComps={groupComps}
            highlightIds={highlightSet}
            selectedWires={groupWires}
            arrowFor={selectedComp}
            acMeasure={s.doc.analysis.acMeasure}
            interactive
          />
          {/* pinler */}
          {components.map((c) =>
            pinPositions(c).map((p, i) => (
              <g key={`${c.id}-${i}`} data-pin={`${c.id}:${i}`} className="pin">
                <circle cx={p[0] * G} cy={p[1] * G} r={9} fill="transparent" />
                <circle cx={p[0] * G} cy={p[1] * G} r={3.2} className={`pin-dot ${openPins.has(ptKey(p)) ? 'open' : ''}`} />
              </g>
            )),
          )}
          {/* kablo önizleme */}
          {previewPath && (
            <polyline
              points={previewPath.map((q) => `${q[0] * G},${q[1] * G}`).join(' ')}
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
          {/* çevre akımları (saat yönünde) */}
          {methods?.mesh?.ok && s.solutionTab === 'mesh' &&
            methods.mesh.meshes.map((m) => (
              <g key={m.name} transform={`translate(${m.center[0] * G} ${m.center[1] * G})`} pointerEvents="none">
                <path d="M 0 -15 A 15 15 0 1 1 -14.3 -4.6" fill="none" stroke="#c2410c" strokeWidth={2} />
                <polygon points="-14.3,-4.6 -18.5,-12 -9,-9.5" fill="#c2410c" transform="rotate(-8 -14.3 -4.6)" />
                <text y={1} fontSize={12} fontWeight={700} fill="#c2410c" textAnchor="middle" dominantBaseline="central" fontFamily="DejaVuSans, sans-serif">
                  {m.name}
                </text>
              </g>
            ))}
          {/* süperdüğümler */}
          {methods?.node?.ok && s.solutionTab === 'node' &&
            methods.node.supernodes.map((sn, i) => {
              const set = new Set(sn);
              const ptsIn: Pt[] = [];
              for (const c of components) pinPositions(c).forEach((p, k) => set.has(methods.nl.pinNodes[c.id]?.[k]) && ptsIn.push(p));
              for (const w of wires) if (set.has(methods.nl.wireNodes[w.id])) ptsIn.push(w.from, w.to);
              if (!ptsIn.length) return null;
              const xs = ptsIn.map((p) => p[0]);
              const ys = ptsIn.map((p) => p[1]);
              const x0 = Math.min(...xs) - 0.8, x1 = Math.max(...xs) + 0.8, y0 = Math.min(...ys) - 0.8, y1 = Math.max(...ys) + 0.8;
              return (
                <g key={i} pointerEvents="none">
                  <rect x={x0 * G} y={y0 * G} width={(x1 - x0) * G} height={(y1 - y0) * G} rx={10} fill="rgba(15,118,110,0.06)" stroke="#0f766e" strokeWidth={1.6} strokeDasharray="7 5" />
                  <text x={x0 * G + 6} y={y0 * G - 6} fontSize={11} fontWeight={700} fill="#0f766e" fontFamily="DejaVuSans, sans-serif">
                    süperdüğüm {`{${sn.join(', ')}}`}
                  </text>
                </g>
              );
            })}
          {box && (
            <rect
              x={Math.min(box.a[0], box.b[0]) * G}
              y={Math.min(box.a[1], box.b[1]) * G}
              width={Math.abs(box.b[0] - box.a[0]) * G}
              height={Math.abs(box.b[1] - box.a[1]) * G}
              fill="rgba(37,87,214,0.08)"
              stroke={SEL_COLOR}
              strokeDasharray="5 4"
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
      {s.pickCtrlFor && (
        <div className="pick-banner" role="status">
          <span>{s.pickCtrlFor} için kontrol bileşenine dokunun</span>
          <button className="btn" onClick={() => s.setPickCtrl(null)}>İptal</button>
        </div>
      )}
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
