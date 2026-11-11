// Alt grafik paneli: geçici rejimde v(t) ve i(t), AC taramada Bode grafikleri.
import { Chart, ChartConfiguration } from 'chart.js';
import { useEffect, useMemo, useRef } from 'react';
import { formatEng } from '../core/units';
import { isStale, useStore } from '../state/store';
import { bodeConfigs, transientConfigs } from './chartConfig';
import { stepIndex } from './values';

type Cfg = ChartConfiguration<'line', { x: number; y: number }[]>;

function LineChart({ cfg, onPickX, markerX }: { cfg: Cfg; onPickX?: (x: number) => void; markerX?: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart<'line', { x: number; y: number }[]> | null>(null);
  const marker = useRef<number | null | undefined>(markerX);
  marker.current = markerX;

  useEffect(() => {
    const plugin = {
      id: 'tmarker',
      afterDraw: (c: Chart) => {
        const x = marker.current;
        if (x === null || x === undefined) return;
        const sx = c.scales.x.getPixelForValue(x);
        const { top, bottom } = c.chartArea;
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
  }, [markerX]);

  return (
    <div className="chart-box">
      <canvas ref={ref} />
    </div>
  );
}

export function Plots() {
  const s = useStore();
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
      const { v, i } = transientConfigs(res, ids);
      return [v, i];
    }
    if (res.kind === 'ac' && res.sweep) {
      const { mag, ph } = bodeConfigs(res, ids);
      return [mag, ph];
    }
    return null;
  }, [res, ids]);

  let body: JSX.Element;
  if (!res) body = <p className="muted">Grafikler, geçici rejim ve AC frekans taraması analizlerinden sonra burada görünür.</p>;
  else if (res.kind === 'dc') body = <p className="muted">DC analizde grafik yok. Geçici rejim ya da AC tarama seçin.</p>;
  else if (res.kind === 'ac' && !res.sweep)
    body = <p className="muted">Bode grafiği için analiz ayarlarından “Frekans taraması”nı açın.</p>;
  else if (!cfgs) body = <p className="muted">Grafiğini görmek istediğiniz bileşeni seçin ya da aşağıdan ekleyin.</p>;
  else {
    const tr = res.kind === 'transient' ? res : null;
    const k = tr ? stepIndex(tr, s.tIndex) : null;
    const pick = tr
      ? (x: number) => {
          const kk = Math.round(x / tr.h);
          s.setTIndex(Math.max(0, Math.min(tr.t.length - 1, kk)));
        }
      : undefined;
    body = (
      <div className="charts">
        {cfgs.map((c, i) => (
          <LineChart key={i} cfg={c} onPickX={pick} markerX={tr && k !== null ? tr.t[k] : null} />
        ))}
      </div>
    );
  }

  const tr = res?.kind === 'transient' ? res : null;
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
      {body}
    </div>
  );
}
