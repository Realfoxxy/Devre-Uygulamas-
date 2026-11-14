// İkinci derece kartı (Bölüm 9): durum denklemleri, karakteristik denklem, sönüm türü,
// s-düzlemi grafiği (direnç kaydırıcısıyla canlı), zorlanmış ve tam yanıt.
import { useMemo, useState } from 'react';
import { abs } from '../core/complex';
import { buildNetlist } from '../core/netlist';
import { formatEng } from '../core/units';
import { num } from '../solver/methods/linear';
import { completeResponse, secondOrderAnalysis, SecondOrderResult } from '../solver/methods/secondOrder';
import { isStale, useStore } from '../state/store';

function SPlane({ so }: { so: SecondOrderResult }) {
  const [picked, setPicked] = useState<number | null>(null);
  const R = Math.max(1e-12, so.omega0 ?? 0, ...so.roots.map(abs)) * 1.25;
  const W = 240;
  const c = W / 2;
  const k = (W / 2 - 12) / R;
  const x = (v: number) => c + v * k;
  const y = (v: number) => c - v * k;
  return (
    <div className="splane">
      <svg viewBox={`0 0 ${W} ${W}`} role="img" aria-label="s-düzlemi">
        <rect width={W} height={W} fill="#fff" />
        <line x1={6} x2={W - 6} y1={c} y2={c} stroke="#c8ced9" />
        <line y1={6} y2={W - 6} x1={c} x2={c} stroke="#c8ced9" />
        <text x={W - 10} y={c - 4} fontSize={10} fill="#6b7280" textAnchor="end">σ</text>
        <text x={c + 4} y={14} fontSize={10} fill="#6b7280">jω</text>
        {so.omega0 !== undefined && so.omega0 > 0 && (
          <path d={`M ${x(0)} ${y(so.omega0)} A ${so.omega0 * k} ${so.omega0 * k} 0 0 0 ${x(0)} ${y(-so.omega0)}`} fill="none" stroke="#7c3aed" strokeDasharray="4 3" />
        )}
        {so.roots.map((r, i) => (
          <g key={i} onClick={() => setPicked(i)} style={{ cursor: 'pointer' }}>
            <circle cx={x(r.re)} cy={y(r.im)} r={12} fill="transparent" />
            <path d={`M ${x(r.re) - 5} ${y(r.im) - 5} L ${x(r.re) + 5} ${y(r.im) + 5} M ${x(r.re) + 5} ${y(r.im) - 5} L ${x(r.re) - 5} ${y(r.im) + 5}`} stroke="#d92d20" strokeWidth={2.4} />
          </g>
        ))}
      </svg>
      <p className="muted small">
        {picked !== null && so.roots[picked]
          ? `s${picked + 1} = ${num(so.roots[picked].re)}${Math.abs(so.roots[picked].im) > 1e-12 ? ` ${so.roots[picked].im < 0 ? '−' : '+'} j${num(Math.abs(so.roots[picked].im))}` : ''}`
          : 'Köklere dokunun: değeri görünür.'}
        {so.omega0 ? ` Kesikli yarım çember: yarıçap ω₀ = ${num(so.omega0)} rad/s.` : ''}
      </p>
    </div>
  );
}

export function SecondOrderCard() {
  const s = useStore();
  const res = s.results;
  const components = s.doc.components;
  const wires = s.doc.wires;
  const resistors = components.filter((c) => c.type === 'R');
  const [rId, setRId] = useState<string>('');
  const [factor, setFactor] = useState(0); // log10 çarpan
  const [out, setOut] = useState(0);
  const live = useMemo(() => {
    const nl = buildNetlist(components, wires);
    if (rId) {
      const e = nl.elements.find((x) => x.id === rId);
      if (e) e.params = { ...e.params, value: Number(e.params.value) * Math.pow(10, factor) };
    }
    try {
      return secondOrderAnalysis(nl, out);
    } catch {
      return null;
    }
  }, [components, wires, rId, factor, out]);
  const resp = useMemo(() => {
    if (!res || res.kind !== 'transient' || !res.secondOrder || isStale(s) || !s.resultsNetlist || factor !== 0) return null;
    try {
      return completeResponse(s.resultsNetlist, res.secondOrder.analysis, res, out);
    } catch {
      return null;
    }
  }, [res, s, out, factor]);
  if (!res || res.kind !== 'transient' || !res.secondOrder || isStale(s) || !live || !live.ok) return null;
  const so = live;
  const rComp = resistors.find((r) => r.id === rId);
  return (
    <div className="first-order">
      <div className="panel-title">{so.order === 2 ? 'İkinci derece devre' : `${so.order}. derece devre`}</div>
      <p className="small">
        Derece = bağımsız C sayısı + bağımsız L sayısı = <b>{so.order}</b>. Durum değişkenleri: {so.states.map((x) => x.name).join(', ')}.
      </p>
      {so.dependent.map((d) => (
        <div key={d.id} className="issue info">
          {d.reason}
        </div>
      ))}
      <div className="eq-title">Durum denklemleri (dx/dt = A·x + B·u)</div>
      {so.stateEquations.map((e, i) => (
        <div key={i} className="eq">
          {e}
        </div>
      ))}
      <p className="muted small">Bağımsız kaynaklar sıfırlanıp C yerine o gerilimde kaynak, L yerine o akımda kaynak konuldu; her durum sırayla 1 yapılarak dirençli devre çözüldü (Bölüm 9.9).</p>
      {so.order >= 2 && so.states.length > 1 && (
        <label className="th-load">
          <span>Çıkış değişkeni</span>
          <select value={out} onChange={(e) => setOut(Number(e.target.value))}>
            {so.states.map((x, i) => (
              <option key={x.id} value={i}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {so.odeText && <div className="eq">{so.odeText}</div>}
      <div className="eq-title">Karakteristik denklem det(sI − A) = 0</div>
      <div className="eq simp">{so.polyText}</div>
      {so.order === 2 && so.alpha !== undefined && (
        <p className="small">
          α = {num(so.alpha)} 1/s, ω₀ = {num(so.omega0!)} rad/s
        </p>
      )}
      {so.rlcText && <p className="small">{so.rlcText}</p>}
      <div className={`issue ${so.damping === 'unstable' ? 'warning' : 'info'}`}>{so.dampingText}</div>
      <SPlane so={so} />
      {resistors.length > 0 && (
        <div className="r-slider">
          <label className="th-load">
            <span>Direnç değiştir</span>
            <select
              value={rId}
              onChange={(e) => {
                setRId(e.target.value);
                setFactor(0);
              }}
            >
              <option value="">— seçin —</option>
              {resistors.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id}
                </option>
              ))}
            </select>
          </label>
          {rComp && (
            <label className="pot-slider">
              <span>
                {rComp.id} = {formatEng(Number(rComp.params.value) * Math.pow(10, factor), 'Ω')}
              </span>
              <input type="range" min={-2} max={2} step={0.01} value={factor} onChange={(e) => setFactor(Number(e.target.value))} aria-label="Direnç değeri" />
            </label>
          )}
          {rComp && factor !== 0 && <p className="muted small">Kökler canlı güncellenir; devre değişmedi. Tam yanıt yalnızca devredeki değerle gösterilir.</p>}
        </div>
      )}
      {resp && (
        <>
          <div className="eq-title">Tam yanıt x = x_n + x_f</div>
          <div className="small">{resp.forcedText}</div>
          <div className="eq simp">{resp.formula}</div>
          {resp.note && <div className="issue info">{resp.note}</div>}
          {resp.deviation !== undefined && (
            <div className={`small ${resp.deviation <= 0.5 ? 'ok-text' : 'bad-text'}`}>Formül ile simülasyon farkı: %{resp.deviation.toFixed(2)} {resp.deviation <= 0.5 ? '✓' : ''}</div>
          )}
          <p className="muted small">A₁, A₂ sabitleri x(0⁺) ve dx/dt(0⁺)'dan bulundu; dx/dt(0⁺) durum denklemlerinden (Bölüm 9.9, adım 10).</p>
        </>
      )}
    </div>
  );
}
