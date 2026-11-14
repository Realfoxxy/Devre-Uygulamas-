// "Çözümü göster" panelinin Düğüm ve Çevre sekmeleri: öğrencinin yazacağı denklemler,
// matris biçimi, iki yöntemin karşılaştırması ve dışa aktarma düğmeleri.
import { useState } from 'react';
import { netlistText } from '../core/netlist';
import { formatEng } from '../core/units';
import { toLatex, toMatlab, toPython, toSpice } from '../solver/methods/export';
import { num } from '../solver/methods/linear';
import type { MethodResult } from '../solver/methods/nodal';
import { useStore } from '../state/store';
import { useMethods } from './useMethods';

function CopyButton({ label, text }: { label: string; text: () => string }) {
  const [done, setDone] = useState<'ok' | 'err' | null>(null);
  return (
    <button
      className="btn small-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text());
          setDone('ok');
        } catch {
          setDone('err');
        }
        setTimeout(() => setDone(null), 1600);
      }}
    >
      {done === 'ok' ? 'Kopyalandı ✓' : done === 'err' ? 'Kopyalanamadı' : label}
    </button>
  );
}

function Equations({ r, kind }: { r: MethodResult; kind: 'node' | 'mesh' }) {
  const Aname = kind === 'node' ? 'G' : 'R';
  const xname = kind === 'node' ? 'v' : 'i';
  const bname = kind === 'node' ? 'i' : 'v';
  return (
    <div className="eqs">
      {r.given.length > 0 && (
        <div className="eq-block">
          <div className="eq-title">Doğrudan bilinenler</div>
          {r.given.map((g) => (
            <div key={g} className="eq">{g}</div>
          ))}
        </div>
      )}
      {r.defs.length > 0 && (
        <div className="eq-block">
          <div className="eq-title">Kontrol büyüklükleri</div>
          {r.defs.map((d) => (
            <div key={d} className="eq">{d}</div>
          ))}
        </div>
      )}
      {r.equations.map((e, i) => (
        <div key={i} className="eq-block">
          <div className="eq-title">{e.title}</div>
          <div className="eq">{e.text}</div>
          {e.simplified !== e.text && <div className="eq simp">⇒ {e.simplified}</div>}
        </div>
      ))}
      {r.unknowns.length > 0 && (
        <>
          <div className="eq-title">
            Matris biçimi {Aname}·{xname} = {bname}
          </div>
          <div className="matrix-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  {r.unknowns.map((u) => (
                    <th key={u}>{u}</th>
                  ))}
                  <th className="sep">{bname}</th>
                  <th className="sep">çözüm</th>
                </tr>
              </thead>
              <tbody>
                {r.A.map((row, i) => (
                  <tr key={i}>
                    {row.map((v, j) => (
                      <td key={j}>{num(v)}</td>
                    ))}
                    <td className="sep">{num(r.b[i])}</td>
                    <td className="sep x">
                      <span className="xl">{r.unknowns[i]} =</span>{' '}
                      {r.solution ? formatEng(r.solution[i], kind === 'node' ? 'V' : 'A') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="copy-row">
        <CopyButton label="MATLAB" text={() => toMatlab(r.A, r.b, r.unknowns, kind === 'node' ? 'Düğüm denklemleri G·v = i' : 'Çevre denklemleri R·i = v', Aname)} />
        <CopyButton label="Python (NumPy)" text={() => toPython(r.A, r.b, r.unknowns, kind === 'node' ? 'Düğüm denklemleri G·v = i' : 'Çevre denklemleri R·i = v', Aname)} />
        <CopyButton label="LaTeX" text={() => toLatex(r.equations, r.A, r.b, r.unknowns, Aname)} />
      </div>
    </div>
  );
}

export function MethodsView({ tab }: { tab: 'node' | 'mesh' }) {
  const m = useMethods(true);
  const meta = useStore((s) => s.doc.meta);
  if (!m) return null;
  if (m.error) return <div className="issue error">{m.error}</div>;
  const nodeCount = m.node?.ok ? m.node.unknowns.length : null;
  const meshCount = m.mesh?.ok ? m.mesh.unknowns.length : null;
  return (
    <div className="methods">
      <p className="compare">
        Bu devre için düğüm yöntemi <b>{nodeCount ?? '—'}</b>, çevre yöntemi <b>{meshCount ?? '—'}</b> denklem gerektirir
        {nodeCount !== null && meshCount !== null && nodeCount !== meshCount && (
          <> — {nodeCount < meshCount ? 'düğüm' : 'çevre'} yöntemi daha kısa.</>
        )}
      </p>
      <p className="muted small">
        Denklemler dirençli (DC) hal için yazılır: kapasitör açık, bobin kısa devre. KAY: düğümden çıkan akımların toplamı 0;
        KGY: çevre boyunca gerilim düşümlerinin toplamı 0.
      </p>
      {tab === 'node' ? (
        m.node?.ok ? (
          <>
            {m.node.supernodes.length > 0 && (
              <p className="small">
                Süperdüğüm (supernode): {m.node.supernodes.map((s) => `{${s.join(', ')}}`).join(', ')} — çizimde kesikli çerçeveyle
                gösterildi.
              </p>
            )}
            <Equations r={m.node} kind="node" />
          </>
        ) : (
          <div className="issue warning">{m.node?.message}</div>
        )
      ) : m.mesh?.ok ? (
        <>
          <p className="small">Çevre akımları çizimde saat yönünde ↻ okla gösterildi.</p>
          {m.mesh.supermeshes.length > 0 && (
            <p className="small">Süperçevre (supermesh): {m.mesh.supermeshes.map((s) => `{${s.join(', ')}}`).join(', ')}</p>
          )}
          <Equations r={m.mesh} kind="mesh" />
        </>
      ) : (
        <div className="issue warning">{m.mesh?.message}</div>
      )}
      <div className="copy-row">
        <CopyButton label="SPICE (.cir)" text={() => toSpice(m.nl, meta.deney || 'Devre Lab Simülatörü')} />
      </div>
      <details className="small">
        <summary>Netlist</summary>
        <pre className="netlist">{netlistText(m.nl)}</pre>
      </details>
    </div>
  );
}
