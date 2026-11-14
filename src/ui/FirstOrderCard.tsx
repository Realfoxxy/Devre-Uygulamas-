// Birinci derece tam yanıt kartı ve 0⁻ / 0⁺ tablosu (Bölüm 7.8, 8.2–8.7).
import { PARTS } from '../core/circuit';
import { formatEng } from '../core/units';
import { isStale, useStore } from '../state/store';

export function InitialTable() {
  const s = useStore();
  const res = s.results;
  if (!res || res.kind !== 'transient' || !res.initial || isStale(s)) return null;
  const { before, after } = res.initial;
  const comps = s.doc.components.filter((c) => c.type !== 'GND' && before[c.id] && after[c.id]);
  const jump = (a: number, b: number) => Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  return (
    <div className="initial">
      <div className="panel-title">0⁻ ve 0⁺ değerleri</div>
      <table className="grid-table">
        <thead>
          <tr>
            <th>Ad</th>
            <th>v(0⁻)</th>
            <th>v(0⁺)</th>
            <th>i(0⁻)</th>
            <th>i(0⁺)</th>
          </tr>
        </thead>
        <tbody>
          {comps.map((c) => {
            const b = before[c.id];
            const a = after[c.id];
            const contV = c.type === 'C';
            const contI = c.type === 'L';
            return (
              <tr key={c.id}>
                <td>
                  <b>{c.id}</b>
                </td>
                <td>{formatEng(b.V, 'V')}</td>
                <td className={contV ? 'cont' : jump(a.V, b.V) ? 'jump' : ''}>{formatEng(a.V, 'V')}</td>
                <td>{formatEng(b.I, 'A')}</td>
                <td className={contI ? 'cont' : jump(a.I, b.I) ? 'jump' : ''}>{formatEng(a.I, 'A')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        <span className="tag cont">sürekli</span> kapasitör gerilimi ve bobin akımı sıçrayamaz: v_C(0⁺) = v_C(0⁻), i_L(0⁺) = i_L(0⁻).{' '}
        <span className="tag jump">sıçrama</span> direnç akımı, bobin gerilimi, kapasitör akımı anahtarlama anında değişebilir.
      </p>
      {s.doc.components
        .filter((c) => (c.type === 'C' || c.type === 'L') && before[c.id])
        .map((c) => {
          const v = Number(c.params.value);
          const w = c.type === 'C' ? 0.5 * v * before[c.id].V ** 2 : 0.5 * v * before[c.id].I ** 2;
          return (
            <p key={c.id} className="small">
              {c.id} 0⁻'da depolanan enerji: {c.type === 'C' ? '½Cv²' : '½Li²'} = <b>{formatEng(w, 'J')}</b>
            </p>
          );
        })}
    </div>
  );
}

export function FirstOrderCard() {
  const s = useStore();
  const res = s.results;
  if (!res || res.kind !== 'transient' || !res.firstOrder || isStale(s)) return null;
  const fo = res.firstOrder;
  const el = s.doc.components.find((c) => c.id === fo.elem);
  return (
    <div className="first-order">
      <div className="panel-title">Birinci derece tam yanıt</div>
      <p className="muted small">
        Tek enerji depolayan eleman: <b>{fo.elem}</b> ({el ? PARTS[el.type].name.toLowerCase() : ''}). Her anahtarlama ya da basamak anında yeni bir
        aralık başlar; bir aralığın son değeri sonrakinin başlangıcıdır. x(t) = x(∞) + [x(t₀⁺) − x(∞)]·e^(−(t − t₀)/τ)
      </p>
      {fo.intervals.map((iv, i) => (
        <div key={i} className="fo-interval">
          <div className="eq-title">
            Aralık {i + 1}: {formatEng(iv.t0, 's')} – {formatEng(iv.t1, 's')}
          </div>
          {iv.tauText && <div className="eq" tabIndex={0}>{iv.tauText}</div>}
          {iv.xinf !== null && (
            <div className="small">
              {fo.symbol}(t₀⁺) = {formatEng(iv.x0, fo.unit!)}, {fo.symbol}(∞) = {formatEng(iv.xinf, fo.unit!)}
            </div>
          )}
          {iv.forcedText && <div className="small">{iv.forcedText}</div>}
          {iv.formula && <div className="eq simp" tabIndex={0}>{iv.formula}</div>}
          {iv.note && <div className="issue info">{iv.note}</div>}
          {iv.deviation !== undefined && (
            <div className={`small ${iv.deviation <= 0.5 ? 'ok-text' : 'bad-text'}`}>
              Formül ile simülasyon farkı: %{iv.deviation.toFixed(2)} {iv.deviation <= 0.5 ? '✓' : ''}
            </div>
          )}
        </div>
      ))}
      <p className="muted small">R_th, bağımlı kaynaklar devrede kalarak elemanın uçlarından bulunur. Grafikte τ, 3τ, 5τ dikey çizgilerle gösterilir.</p>
    </div>
  );
}
