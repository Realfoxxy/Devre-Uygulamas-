// Bağımsız kaynakların dalga biçimi seçimi, parametreleri ve küçük önizleme grafiği.
import { Component, Params, PARTS, SOURCE_MODES, SourceMode } from '../core/circuit';
import { formatEng } from '../core/units';
import { breakpoints, waveAt, waveTimes } from '../solver/waveform';
import { useStore } from '../state/store';
import { ValueInput } from './ValueInput';

/** Mod değişince eksik parametreler için makul varsayılanlar */
export function defaultsFor(mode: SourceMode, p: Params): Params {
  const level = p.mode === 'AC' ? p.amp ?? 5 : p.value || 5;
  switch (mode) {
    case 'STEP':
      return { w0: p.w0 ?? 0, w1: p.w1 ?? level, td: p.td ?? 0 };
    case 'PULSE':
      return { w0: p.w0 ?? 0, w1: p.w1 ?? level, td: p.td ?? 0, pw: p.pw ?? 1e-3, per: p.per ?? 2e-3 };
    case 'EXP':
      return { wk: p.wk ?? level, wb: p.wb ?? 1000, td: p.td ?? 0 };
    case 'RAMP':
      return { wk: p.wk ?? 1000, td: p.td ?? 0 };
    case 'SINE_U':
      return { amp: p.amp ?? level, freq: p.freq ?? 1000, phase: p.phase ?? 0, td: p.td ?? 0 };
    case 'PWL':
      return { pwl: p.pwl ?? [[0, 0], [1e-3, level], [2e-3, level]] };
    default:
      return {};
  }
}

function Preview({ p, unit }: { p: Params; unit: string }) {
  const { end } = waveTimes(p);
  const T = Math.max(end * 1.25, p.mode === 'PULSE' && p.per ? p.per * 2.2 : 0) || 1e-3;
  const ts: number[] = [];
  for (let i = 0; i <= 240; i++) ts.push((T * i) / 240);
  for (const b of breakpoints(p, T)) ts.push(b - 1e-12 * T, b);
  ts.sort((a, b) => a - b);
  const vs = ts.map((t) => waveAt(p, t));
  const lo = Math.min(0, ...vs);
  const hi = Math.max(0, ...vs);
  const span = hi - lo || 1;
  const W = 260;
  const H = 70;
  const x = (t: number) => 26 + (t / T) * (W - 32);
  const y = (v: number) => 6 + (1 - (v - lo) / span) * (H - 18);
  return (
    <svg className="wave-preview" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dalga biçimi önizlemesi">
      <line x1={26} x2={W - 4} y1={y(0)} y2={y(0)} stroke="#c8ced9" />
      <line x1={26} x2={26} y1={4} y2={H - 12} stroke="#c8ced9" />
      <polyline points={ts.map((t, i) => `${x(t).toFixed(1)},${y(vs[i]).toFixed(1)}`).join(' ')} fill="none" stroke="#2557d6" strokeWidth={1.8} />
      <text x={2} y={y(hi) + 4} fontSize={8} fill="#6b7280">{formatEng(hi, unit)}</text>
      {lo < 0 && <text x={2} y={y(lo)} fontSize={8} fill="#6b7280">{formatEng(lo, unit)}</text>}
      <text x={W - 4} y={H - 2} fontSize={8} fill="#6b7280" textAnchor="end">{formatEng(T, 's')}</text>
      <text x={28} y={H - 2} fontSize={8} fill="#6b7280">0</text>
    </svg>
  );
}

export function SourceFields({ comp, compact }: { comp: Component; compact?: boolean }) {
  const update = useStore((s) => s.updateParams);
  if (comp.type !== 'V' && comp.type !== 'I') return null;
  const p = comp.params;
  const u = PARTS[comp.type].unit;
  const mode = (p.mode ?? 'DC') as SourceMode;
  const set = (k: keyof Params) => (v: number | undefined) => update(comp.id, { [k]: v ?? 0 });
  const field = (k: keyof Params, label: string, unit: string, opt: { positive?: boolean; focus?: boolean } = {}) => (
    <label key={k}>
      <span>{label}</span>
      <ValueInput value={p[k] as number | undefined} unit={unit} onCommit={set(k)} positive={opt.positive} autoFocusEvent={opt.focus && !compact} />
    </label>
  );
  const info = SOURCE_MODES.find((m) => m.mode === mode)!;
  const pts = p.pwl ?? [];
  return (
    <>
      <label>
        <span>Dalga biçimi</span>
        <select
          className="mode-select"
          value={mode}
          onChange={(e) => {
            const m = e.target.value as SourceMode;
            update(comp.id, { mode: m, ...defaultsFor(m, p) });
          }}
          aria-label="Dalga biçimi"
        >
          {SOURCE_MODES.map((m) => (
            <option key={m.mode} value={m.mode}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {mode === 'DC' && field('value', 'Değer', u, { focus: true })}
      {(mode === 'AC' || mode === 'SINE_U') && (
        <>
          {field('amp', 'Genlik (tepe)', u, { focus: true })}
          {!compact && field('freq', 'Frekans', 'Hz', { positive: true })}
          {!compact && field('phase', 'Faz θ', '°')}
        </>
      )}
      {(mode === 'STEP' || mode === 'PULSE') && (
        <>
          {field('w0', mode === 'STEP' ? 'V₀ (t < t₀)' : 'V₁ (alt seviye)', u, { focus: true })}
          {field('w1', mode === 'STEP' ? 'V₁ (t ≥ t₀)' : 'V₂ (üst seviye)', u)}
        </>
      )}
      {(mode === 'EXP' || mode === 'RAMP') && field('wk', mode === 'EXP' ? 'K' : 'Eğim K', mode === 'EXP' ? u : `${u}/s`, { focus: true })}
      {!compact && mode === 'EXP' && field('wb', 'b', '1/s', { positive: true })}
      {!compact && mode === 'PULSE' && (
        <>
          {field('pw', 'Darbe genişliği', 's', { positive: true })}
          {field('per', 'Periyot (0: tek darbe)', 's')}
        </>
      )}
      {!compact && ['STEP', 'PULSE', 'EXP', 'RAMP', 'SINE_U'].includes(mode) && field('td', mode === 'PULSE' ? 'Gecikme t₀' : 't₀', 's')}
      {!compact && mode === 'PWL' && (
        <div className="pwl">
          <div className="pwl-head">
            <span>t (s)</span>
            <span>değer ({u})</span>
            <span />
          </div>
          {pts.map(([t, v], i) => (
            <div key={i} className="pwl-row">
              <ValueInput
                value={t}
                onCommit={(nv) => {
                  const np = pts.map((q, j) => (j === i ? ([nv ?? 0, q[1]] as [number, number]) : q)).sort((a, b) => a[0] - b[0]);
                  update(comp.id, { pwl: np });
                }}
              />
              <ValueInput value={v} onCommit={(nv) => update(comp.id, { pwl: pts.map((q, j) => (j === i ? ([q[0], nv ?? 0] as [number, number]) : q)) })} />
              <button className="icon-btn" aria-label="Noktayı sil" disabled={pts.length <= 1} onClick={() => update(comp.id, { pwl: pts.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <button
            className="btn small-btn"
            onClick={() => {
              const last = pts[pts.length - 1] ?? [0, 0];
              update(comp.id, { pwl: [...pts, [last[0] + (pts.length > 1 ? last[0] - pts[pts.length - 2][0] : 1e-3), last[1]]] });
            }}
          >
            + Nokta ekle
          </button>
        </div>
      )}
      {!compact && mode !== 'DC' && (
        <>
          <p className="muted small">
            {comp.type === 'V' ? 'v' : 'i'}(t) = {info.formula}
            {mode === 'AC' ? ' — AC analizde fazör olarak, geçici rejimde sinüs olarak kullanılır.' : ' — DC analiz t < 0 değerini, AC analiz bu kaynağı 0 kabul eder.'}
          </p>
          <Preview p={p} unit={u} />
        </>
      )}
    </>
  );
}
