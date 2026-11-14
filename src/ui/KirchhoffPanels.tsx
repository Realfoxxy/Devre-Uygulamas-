// Kirchhoff kontrolleri (KAY / KGY) ve çoklu seçimde seri / paralel analizi.
import { useMemo, useState } from 'react';
import { buildNetlist } from '../core/netlist';
import { kclAt, kvlLoop } from '../solver/methods/kirchhoff';
import { seriesParallel } from '../solver/methods/seriesParallel';
import { isStale, useStore } from '../state/store';
import { compVI, valueText } from './values';

/** Kabloya (düğüme) dokununca: o düğüme bağlı dalların akımları ve toplamı */
export function KclPanel({ wireId }: { wireId: string }) {
  const s = useStore();
  const res = s.results;
  const nl = s.resultsNetlist;
  if (!res || !nl || isStale(s)) return <p className="muted small">KAY kontrolü için analizi çalıştırın.</p>;
  const node = nl.wireNodes[wireId];
  if (node === undefined || node < 0) return <p className="muted small">Bu kablo hiçbir bileşene bağlı değil.</p>;
  const get = (id: string, part: 're' | 'im') => compVI(res, id, s.tIndex)?.I[part] ?? 0;
  const re = kclAt(nl, node, (id) => get(id, 're'));
  const im = kclAt(nl, node, (id) => get(id, 'im'));
  return (
    <div className="kcl">
      <div className="panel-title">KAY — düğüm {node === 0 ? '0 (toprak)' : node}</div>
      <table className="grid-table">
        <thead>
          <tr>
            <th>Dal</th>
            <th>Akım</th>
            <th>Yön</th>
          </tr>
        </thead>
        <tbody>
          {re.rows.map((r, i) => {
            const z = { re: r.current, im: im.rows[i].current };
            const out = res.kind === 'ac' ? true : r.current >= 0;
            return (
              <tr key={r.id} onClick={() => s.select({ kind: 'comp', id: r.id })} className="clickable">
                <td>
                  <b>{r.id}</b>
                </td>
                <td>{valueText(res, out ? z : { re: -z.re, im: -z.im }, 'A')}</td>
                <td>{res.kind === 'ac' ? 'çıkan (fazör)' : out ? 'çıkan (+)' : 'giren (−)'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small">
        Σ çıkan − Σ giren = <b>{valueText(res, { re: re.sum, im: im.sum }, 'A')}</b> ✓
      </p>
      <p className="muted small">Kirchhoff'un akım yasası (KAY): bir düğüme giren akımların toplamı çıkanlara eşittir.</p>
    </div>
  );
}

/** Bileşenden geçen en kısa kapalı yolda KGY */
export function KvlPanel({ compId }: { compId: string }) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const res = s.results;
  const nl = s.resultsNetlist;
  if (!res || !nl || isStale(s)) return null;
  const loop = open
    ? {
        re: kvlLoop(nl, compId, (id) => compVI(res, id, s.tIndex)?.V.re ?? 0),
        im: kvlLoop(nl, compId, (id) => compVI(res, id, s.tIndex)?.V.im ?? 0),
      }
    : null;
  return (
    <div className="kvl">
      <button
        className="btn"
        onClick={() => {
          const next = !open;
          setOpen(next);
          const l = next ? kvlLoop(nl, compId, () => 0) : null;
          s.setHighlight(l ? l.rows.map((r) => r.id) : []);
        }}
      >
        {open ? 'Çevreyi gizle' : 'Çevre (KGY) kontrolü'}
      </button>
      {loop && !loop.re && <p className="muted small">Bu bileşenden geçen kapalı bir yol yok.</p>}
      {loop?.re && loop.im && (
        <>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Eleman</th>
                <th>Dolaşma yönünde gerilim düşümü</th>
              </tr>
            </thead>
            <tbody>
              {loop.re.rows.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.id}</b>
                  </td>
                  <td>{valueText(res, { re: r.drop, im: loop.im!.rows[i].drop }, 'V')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small">
            Σ = <b>{valueText(res, { re: loop.re.sum, im: loop.im.sum }, 'V')}</b> ✓ — Kirchhoff'un gerilim yasası (KGY).
          </p>
        </>
      )}
    </div>
  );
}

/** Çoklu seçimde seri / paralel ve bölücü bilgisi */
export function SeriesParallelPanel({ ids }: { ids: string[] }) {
  const components = useStore((s) => s.doc.components);
  const wires = useStore((s) => s.doc.wires);
  const r = useMemo(() => {
    const nl = buildNetlist(components, wires);
    return seriesParallel(nl, ids);
  }, [components, wires, ids]);
  if (!r.lines.length) return null;
  return (
    <div className="sp">
      <div className="panel-title">Seri / paralel</div>
      {r.lines.map((l, i) => (
        <p key={i} className={i === 0 ? 'small' : 'eq small'}>
          {l}
        </p>
      ))}
    </div>
  );
}
