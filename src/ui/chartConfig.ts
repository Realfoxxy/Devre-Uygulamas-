// Chart.js yapılandırmaları: v(t), i(t) ve Bode grafikleri (ekran ve PDF için ortak).
import {
  CategoryScale,
  Chart,
  ChartConfiguration,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  LogarithmicScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { abs, argDeg, div } from '../core/complex';
import type { ACResult, TranResult } from '../core/results';
import { formatEng } from '../core/units';

Chart.register(LineController, LineElement, PointElement, LinearScale, LogarithmicScale, CategoryScale, Tooltip, Legend);

export const SERIES_COLORS = ['#2557d6', '#c2410c', '#0f766e', '#7c3aed', '#be185d', '#4d7c0f', '#0369a1', '#a16207'];

const MAX_POINTS = 1500;

function decimate(t: ArrayLike<number>, y: ArrayLike<number>) {
  const n = t.length;
  const stride = Math.max(1, Math.ceil(n / MAX_POINTS));
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i += stride) pts.push({ x: t[i], y: y[i] });
  if ((n - 1) % stride !== 0) pts.push({ x: t[n - 1], y: y[n - 1] });
  return pts;
}

type LineCfg = ChartConfiguration<'line', { x: number; y: number }[]>;

function baseLine(title: string, xUnit: string, yUnit: string, logX = false, print = false): LineCfg {
  return {
    type: 'line',
    data: { datasets: [] },
    options: {
      animation: false,
      responsive: !print,
      maintainAspectRatio: false,
      parsing: false,
      normalized: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 14, font: { size: print ? 22 : 11 } } },
        title: { display: false, text: title },
        tooltip: {
          callbacks: {
            title: (items) => formatEng(items[0].parsed.x, xUnit),
            label: (item) => `${item.dataset.label}: ${yUnit === 'dB' || yUnit === '°' ? item.parsed.y.toFixed(2) + ' ' + yUnit : formatEng(item.parsed.y, yUnit)}`,
          },
        },
      },
      elements: { point: { radius: 0 }, line: { borderWidth: print ? 3 : 1.8, tension: 0 } },
      scales: {
        x: {
          type: logX ? 'logarithmic' : 'linear',
          title: { display: true, text: logX ? 'Frekans (Hz)' : 'Zaman', font: { size: print ? 22 : 11 } },
          ticks: {
            font: { size: print ? 20 : 10 },
            maxTicksLimit: 8,
            autoSkip: !logX ? false : true,
            callback: (v) => {
              const n = Number(v);
              if (logX) {
                const l = Math.log10(n);
                return Math.abs(l - Math.round(l)) < 1e-6 ? formatEng(n, 'Hz').replace(/\.0+(?=\s)/, '') : '';
              }
              return formatEng(n, xUnit);
            },
          },
          grid: { color: '#e7eaf0' },
        },
        y: {
          title: { display: true, text: title, font: { size: print ? 22 : 11 } },
          ticks: {
            font: { size: print ? 20 : 10 },
            maxTicksLimit: 7,
            callback: (v) => (yUnit === 'dB' || yUnit === '°' ? `${Number(v).toFixed(0)}` : formatEng(Number(v), yUnit)),
          },
          grid: { color: '#e7eaf0' },
        },
      },
    },
  };
}

export function transientConfigs(res: TranResult, ids: string[], print = false, formula?: { id: string; kind: 'V' | 'I'; f: (t: number) => number }) {
  const v = baseLine('Gerilim v(t)', 's', 'V', false, print);
  const i = baseLine('Akım i(t)', 's', 'A', false, print);
  ids.forEach((id, k) => {
    const c = res.comps[id];
    if (!c) return;
    const color = SERIES_COLORS[k % SERIES_COLORS.length];
    v.data.datasets.push({ label: `v ${id}`, data: decimate(res.t, c.V), borderColor: color, backgroundColor: color });
    i.data.datasets.push({ label: `i ${id}`, data: decimate(res.t, c.I), borderColor: color, backgroundColor: color });
  });
  if (formula && ids.includes(formula.id)) {
    const pts: { x: number; y: number }[] = [];
    for (let k = 0; k <= 400; k++) {
      const t = (res.tStop * k) / 400;
      pts.push({ x: t, y: formula.f(t) });
    }
    (formula.kind === 'V' ? v : i).data.datasets.push({ label: `formül ${formula.id}`, data: pts, borderColor: '#d92d20', backgroundColor: '#d92d20', borderDash: [5, 4] });
  }
  for (const cfg of [v, i]) {
    cfg.options!.scales!.x!.min = 0;
    cfg.options!.scales!.x!.max = res.tStop;
  }
  return { v, i };
}

export function bodeConfigs(res: ACResult, ids: string[], print = false) {
  const sw = res.sweep!;
  const ref = sw.refId ? sw.comps[sw.refId].V : null;
  const magTitle = ref ? `Kazanç |V / V_${sw.refId}| (dB)` : 'Genlik (dBV)';
  const mag = baseLine(magTitle, 'Hz', 'dB', true, print);
  const ph = baseLine('Faz (°)', 'Hz', '°', true, print);
  ids.forEach((id, k) => {
    const c = sw.comps[id];
    if (!c) return;
    const color = SERIES_COLORS[k % SERIES_COLORS.length];
    const H = c.V.map((v, i) => (ref ? div(v, ref[i]) : v));
    mag.data.datasets.push({
      label: id,
      data: sw.f.map((f, i) => ({ x: f, y: 20 * Math.log10(Math.max(abs(H[i]), 1e-12)) })),
      borderColor: color,
      backgroundColor: color,
    });
    ph.data.datasets.push({
      label: id,
      data: sw.f.map((f, i) => ({ x: f, y: argDeg(H[i]) })),
      borderColor: color,
      backgroundColor: color,
    });
  });
  for (const cfg of [mag, ph]) {
    cfg.options!.scales!.x!.min = sw.f[0];
    cfg.options!.scales!.x!.max = sw.f[sw.f.length - 1];
  }
  return { mag, ph };
}

/** PDF için grafiği yüksek çözünürlüklü PNG'ye çevirir. */
export function renderChartPNG(cfg: ChartConfiguration<'line', { x: number; y: number }[]>, w = 1600, h = 640): string {
  const holder = document.createElement('div');
  holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px;`;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  holder.appendChild(canvas);
  document.body.appendChild(holder);
  const bg = {
    id: 'whiteBg',
    beforeDraw: (chart: Chart) => {
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    },
  };
  const chart = new Chart(canvas, { ...cfg, options: { ...cfg.options, responsive: false, devicePixelRatio: 1 }, plugins: [bg] });
  const url = canvas.toDataURL('image/png');
  chart.destroy();
  holder.remove();
  return url;
}
