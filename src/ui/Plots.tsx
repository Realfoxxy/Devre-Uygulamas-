// Alt grafik paneli: geçici rejimde v(t) ve i(t), AC taramada Bode grafikleri.
import { Chart, ChartConfiguration } from 'chart.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { compEnergy } from '../core/energy';
import { foEval } from '../solver/methods/firstOrder';
import { responseEval } from '../solver/methods/secondOrder';
import { formatEng } from '../core/units';
import { isStale, useStore } from '../state/store';
import { bodeConfigs, transientConfigs } from './chartConfig';
import { stepIndex } from './values';

type Cfg = ChartConfiguration<'line', { x: number; y: number }[]>;

function LineChart({
  cfg,
  onPickX,
  markerX,
  band,
  vlines,
}: {
  cfg: Cfg;
  onPickX?: (x: number) => void;
  markerX?: number | null;
  /** Enerji aralığı (taranır) */
  band?: [number, number] | null;
  /** Dikey işaret çizgileri (τ, 3τ, 5τ) */
  vlines?: { x: number; label: string }[];
}) {
  const vRef = useRef(vlines);
  vRef.current = vlines;
  const ref = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart<'line', { x: number; y: number }[]> | null>(null);
  const marker = useRef<number | null | undefined>(markerX);
  marker.current = markerX;
  const bandRef = useRef(band);
  bandRef.current = band;

  useEffect(() => {
    const plugin = {
      id: 'tmarker',
      beforeDatasetsDraw: (c: Chart) => {
        const b = bandRef.current;
        if (!b) return;
        const x0 = c.scales.x.getPixelForValue(Math.min(...b));
        const x1 = c.scales.x.getPixelForValue(Math.max(...b));
        const { top, bottom } = c.chartArea;
        c.ctx.save();
        c.ctx.fillStyle = 'rgba(15,118,110,0.12)';
        c.ctx.fillRect(x0, top, x1 - x0, bottom - top);
        c.ctx.restore();
      },
      afterDraw: (c: Chart) => {
        const { top, bottom } = c.chartArea;
        for (const v of vRef.current ?? []) {
          const px = c.scales.x.getPixelForValue(v.x);
          if (px < c.chartArea.left || px > c.chartArea.right) continue;
          c.ctx.save();
          c.ctx.strokeStyle = '#7c3aed';
          c.ctx.setLineDash([2, 3]);
          c.ctx.beginPath();
          c.ctx.moveTo(px, top);
          c.ctx.lineTo(px, bottom);
          c.ctx.stroke();
          c.ctx.fillStyle = '#7c3aed';
          c.ctx.font = '10px sans-serif';
          c.ctx.fillText(v.label, px + 3, top + 10);
          c.ctx.restore();
        }
        const x = marker.current;
        if (x === null || x === undefined) return;
        const sx = c.scales.x.getPixelForValue(x);
        const ctx = c.ctx;
        ctx.save();
        ctx.strokeStyle = '#d92d20';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(sx, top);
        ctx.lineTo(sx, bottom);
        ctx.stroke();
        ctx.restore();
      },
    };
    const c = new Chart(ref.current!, {
      ...cfg,
      options: {
        ...cfg.options,
        onClick: (evt, _el, ch) => {
          if (!onPickX || !evt.x) return;
          onPickX(ch.scales.x.getValueForPixel(evt.x) as number);
        },
      },
      plugins: [plugin],
    });
    chart.current = c;
    return () => c.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  useEffect(() => {
    chart.current?.draw();
  }, [markerX, band]);

  return (
    <div className="chart-box">
      <canvas ref={ref} />
    </div>
  );
}

/** Düzensiz zaman ızgarasında en yakın nokta */
function nearestIndex(t: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t[m] < x) lo = m;
    else hi = m;
  }
  return Math.abs(t[lo] - x) <= Math.abs(t[hi] - x) ? lo : hi;
}

export function Plots() {
  const s = useStore();
  const [energyOn, setEnergyOn] = useState(false);
  const [e1Raw, setE1] = useState(0);
  const [e2Raw, setE2] = useState<number | null>(null);
  const res = s.results;
  const sel = s.selection?.kind === 'comp' ? s.selection.id : null;
  const comps = s.doc.components.filter((c) => c.type !== 'GND');
  const ids = useMemo(() => {
    const set = [...s.plotted];
    if (sel && !set.includes(sel) && comps.some((c) => c.id === sel)) set.unshift(sel);
    return set.filter((id) => res && 'comps' in res && id in res.comps);
  }, [s.plotted, sel, res, comps]);

  const cfgs = useMemo(() => {
    if (!res || !ids.length) return null;
    if (res.kind === 'transient') {
      const resp = res.secondOrder?.response;
      const st = resp ? res.secondOrder!.analysis.states[resp.index] : undefined;
      const fo = res.firstOrder;
      const formula = resp && st
        ? { id: st.id, kind: st.kind === 'C' ? ('V' as const) : ('I' as const), f: (t: number) => responseEval(resp, t) }
        : fo?.elem && fo.intervals.every((iv) => iv.model)
          ? { id: fo.elem, kind: fo.kind === 'C' ? ('V' as const) : ('I' as const), f: (t: number) => { const iv = fo.intervals.find((x) => t >= x.t0 - 1e-15 && t <= x.t1 + 1e-15) ?? fo.intervals[fo.intervals.length - 1]; return foEval(iv, t); } }
          : undefined;
      const { v, i } = transientConfigs(res, ids, false, formula);
      return [v, i];
    }
    if (res.kind === 'ac' && res.sweep) {
      const { mag, ph } = bodeConfigs(res, ids);
      return [mag, ph];
    }
    return null;
  }, [res, ids]);

  const tr = res?.kind === 'transient' ? res : null;
  const energyId = tr ? (ids[0] ?? null) : null;
  const e1 = tr ? Math.min(e1Raw, tr.t.length - 1) : 0;
  const e2 = tr ? Math.min(e2Raw ?? tr.t.length - 1, tr.t.length - 1) : 0;
  const iv0 = tr?.firstOrder?.intervals.find((iv) => iv.tau);
  const tauLines = iv0?.tau ? [1, 3, 5].map((k) => ({ x: iv0.t0 + k * iv0.tau!, label: `${k === 1 ? '' : k}τ` })) : undefined;

  let body: JSX.Element;
  if (!res) body = <p className="muted">Grafikler, geçici rejim ve AC frekans taraması analizlerinden sonra burada görünür.</p>;
  else if (res.kind === 'dc') body = <p className="muted">DC analizde grafik yok. Geçici rejim ya da AC tarama seçin.</p>;
  else if (res.kind === 'ac' && !res.sweep)
    body = <p className="muted">Bode grafiği için analiz ayarlarından “Frekans taraması”nı açın.</p>;
  else if (!cfgs) body = <p className="muted">Grafiğini görmek istediğiniz bileşeni seçin ya da aşağıdan ekleyin.</p>;
  else {
    const k = tr ? stepIndex(tr, s.tIndex) : null;
    const pick = tr ? (x: number) => s.setTIndex(nearestIndex(tr.t, x)) : undefined;
    body = (
      <div className="charts">
        {cfgs.map((c, i) => (
          <LineChart key={i} cfg={c} onPickX={pick} markerX={tr && k !== null ? tr.t[k] : null} band={tr && energyOn ? [tr.t[e1], tr.t[e2]] : null} vlines={tauLines} />
        ))}
      </div>
    );
  }

  return (
    <div className={`plots ${isStale(s) ? 'stale' : ''}`}>
      <div className="plots-head">
        <div className="chips">
          {comps.map((c) => {
            const on = ids.includes(c.id);
            return (
              <button
                key={c.id}
                className={`chip ${on ? 'on' : ''}`}
                onClick={() => (c.id === sel && !s.plotted.includes(c.id) ? s.select(null) : s.togglePlotted(c.id))}
              >
                {c.id}
              </button>
            );
          })}
        </div>
        {tr && (
          <div className="tpick">
            <input
              type="range"
              min={0}
              max={tr.t.length - 1}
              value={stepIndex(tr, s.tIndex)}
              onChange={(e) => s.setTIndex(Number(e.target.value))}
              aria-label="Zaman"
            />
            <span>t = {formatEng(tr.t[stepIndex(tr, s.tIndex)], 's')}</span>
          </div>
        )}
      </div>
      {tr && <p className="muted small">Grafikte bir zamana tıklayın: tüm etiket ve panel değerleri o ana güncellenir.</p>}
      {tr && energyId && (
        <div className="energy">
          <label className="check">
            <input type="checkbox" checked={energyOn} onChange={(e) => setEnergyOn(e.target.checked)} />
            Enerji (w = ∫p dt) — {energyId}
          </label>
          {energyOn && (
            <>
              <label>
                t₁ <input type="range" min={0} max={tr.t.length - 1} value={e1} onChange={(e) => setE1(Number(e.target.value))} aria-label="t1" /> {formatEng(tr.t[e1], 's')}
              </label>
              <label>
                t₂ <input type="range" min={0} max={tr.t.length - 1} value={e2} onChange={(e) => setE2(Number(e.target.value))} aria-label="t2" /> {formatEng(tr.t[e2], 's')}
              </label>
              <b>
                {(() => {
                  const c = tr.comps[energyId];
                  const w = compEnergy(tr.t, c, tr.t[e1], tr.t[e2]);
                  return `bu aralıkta ${formatEng(Math.abs(w), 'J')} ${Math.abs(w) < 1e-15 ? '' : w > 0 ? 'soğurdu' : 'verdi'}`;
                })()}
              </b>
            </>
          )}
        </div>
      )}
      {body}
    </div>
  );
}
