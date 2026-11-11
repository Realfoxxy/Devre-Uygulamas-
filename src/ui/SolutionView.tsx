// "Çözümü göster": netlist, MNA matrisi, sağ taraf ve çözüm vektörü.
import { Fragment } from 'react';
import { netlistText } from '../core/netlist';
import type { SystemDump } from '../core/results';
import { useStore } from '../state/store';

export function fmtCell(v: number | [number, number]): string {
  const f = (x: number) => {
    if (Math.abs(x) < 1e-15) return '0';
    const a = Math.abs(x);
    if (a >= 1e4 || a < 1e-3) return x.toExponential(2).replace('e+', 'e').replace('-', '−');
    return String(parseFloat(x.toPrecision(4))).replace('-', '−');
  };
  if (Array.isArray(v)) {
    const [re, im] = v;
    if (Math.abs(im) < 1e-15) return f(re);
    if (Math.abs(re) < 1e-15) return `${im < 0 ? '−' : ''}j${f(Math.abs(im))}`;
    return `${f(re)}${im < 0 ? '−' : '+'}j${f(Math.abs(im))}`;
  }
  return f(v);
}

export function SolutionView() {
  const results = useStore((s) => s.results);
  const nl = useStore((s) => s.resultsNetlist);
  const sel = useStore((s) => (s.selection?.kind === 'comp' ? s.selection.id : null));
  if (!results || !nl) return <p className="muted">Önce analizi çalıştırın.</p>;
  const sys: SystemDump = results.system;
  const owned = sel ? sys.owners[sel] : undefined;
  const cellSet = new Set(owned?.cells.map(([r, c]) => `${r},${c}`));
  const rhsSet = new Set(owned?.rhs);
  return (
    <div className="solution">
      <h4>Netlist</h4>
      <pre className="netlist">{netlistText(nl) || '—'}</pre>
      <p className="muted small">Sütunlar: eleman, düğüm+, düğüm−, değer. 0 = toprak.</p>
      <h4>MNA denklemi  A · x = b</h4>
      <p className="muted small">{sys.note}</p>
      {sel && owned && (
        <p className="small">
          <span className="swatch" /> <b>{sel}</b> bileşeninin damgası vurgulandı.
        </p>
      )}
      {sel && !owned && <p className="small muted">{sel} matrise damga eklemiyor (açık devre).</p>}
      {!sel && <p className="small muted">Bir bileşen seçin: matrise eklediği hücreler renklenir.</p>}
      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th />
              {sys.labels.map((l) => (
                <th key={l}>{l}</th>
              ))}
              <th className="sep">b</th>
              <th className="sep">x</th>
            </tr>
          </thead>
          <tbody>
            {sys.A.map((row, r) => (
              <tr key={r}>
                <th>{r < sys.labels.length ? `${r + 1}` : ''}</th>
                {row.map((v, c) => (
                  <td key={c} className={cellSet.has(`${r},${c}`) ? 'hl' : ''}>
                    {fmtCell(v)}
                  </td>
                ))}
                <td className={`sep ${rhsSet.has(r) ? 'hl' : ''}`}>{fmtCell(sys.b[r])}</td>
                <td className="sep x">
                  <Fragment>
                    <span className="xl">{sys.labels[r]} =</span> {fmtCell(sys.x[r])}
                  </Fragment>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Satırlar 1…n düğümlerin KCL denklemleri (G matrisi), sonraki satırlar gerilim kaynaklarının denklemleri (Bᵀ). j_X: X
        elemanından + uçtan − uca geçen akım.
      </p>
    </div>
  );
}
