// Teorem sonuç kartları (Bölüm 5): kaynak dönüşümü, süperpozisyon, Thevenin / Norton,
// eşdeğer direnç ve maksimum güç. Sonuçlar güncel çizimden canlı hesaplanır.
import { Chart } from 'chart.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Complex } from '../core/complex';
import { buildNetlist } from '../core/netlist';
import { formatEng } from '../core/units';
import { resolveAcFrequency } from '../solver/ac';
import {
  TheoremMode,
  dcValues,
  maxPower,
  sourceTransform,
  superposition,
  thevenin,
  transformCandidates,
} from '../solver/methods/theorems';
import { validateControls, validateTopology } from '../solver/validate';
import { TheoremCard as Card, useStore } from '../state/store';
import { applySourceTransform } from './applyTransform';
import { phasorText } from './values';
import './chartConfig';

const zText = (z: Complex | null, unit: string, ac: boolean) => {
  if (!z) return '—';
  if (!ac) return formatEng(z.re, unit);
  return `${formatEng(z.re, unit)} ${z.im < 0 ? '−' : '+'} j${formatEng(Math.abs(z.im), unit)}`;
};

function useMode(): { mode: TheoremMode; label: string } {
  const a = useStore((s) => s.doc.analysis);
  const components = useStore((s) => s.doc.components);
  const wires = useStore((s) => s.doc.wires);
  return useMemo(() => {
    if (a.type === 'ac') {
      const { freq } = resolveAcFrequency(buildNetlist(components, wires), a);
      if (freq) return { mode: { kind: 'ac', freq }, label: `AC, f = ${formatEng(freq, 'Hz')} (fazörler tepe değer)` };
    }
    return { mode: { kind: 'dc' }, label: 'DC' };
  }, [a, components, wires]);
}

function useNetlist() {
  const components = useStore((s) => s.doc.components);
  const wires = useStore((s) => s.doc.wires);
  return useMemo(() => {
    const nl = buildNetlist(components, wires);
    const err = [...nl.issues, ...validateControls(nl), ...validateTopology(nl, 'dc')].find((i) => i.level === 'error');
    return { nl, err: err?.message ?? null };
  }, [components, wires]);
}

/** Küçük Thevenin / Norton şeması */
function MiniCircuit({ kind, value, R }: { kind: 'thevenin' | 'norton'; value: string; R: string }) {
  return (
    <svg viewBox="-60 0 260 110" className="mini-circuit" role="img" aria-label={kind === 'thevenin' ? 'Thevenin eşdeğeri' : 'Norton eşdeğeri'}>
      <g fill="none" stroke="currentColor" strokeWidth="2">
        {kind === 'thevenin' ? (
          <>
            <path d="M40 20 H70 M40 90 H170 M40 20 V38 M40 72 V90" />
            <circle cx="40" cy="55" r="17" />
            <path d="M70 20 l5 -7 l10 14 l10 -14 l10 14 l10 -14 l5 7 H170" />
          </>
        ) : (
          <>
            <path d="M40 20 H170 M40 90 H170 M40 20 V38 M40 72 V90 M110 20 V35 M110 75 V90" />
            <circle cx="40" cy="55" r="17" />
            <path d="M110 35 l-7 5 l14 6 l-14 6 l14 6 l-14 6 l14 6 l-7 5" />
          </>
        )}
      </g>
      {kind === 'thevenin' ? (
        <g fontSize="13" fontWeight="700" fill="currentColor" textAnchor="middle" fontFamily="inherit">
          <text x="40" y="51">+</text>
          <text x="40" y="66">−</text>
        </g>
      ) : (
        <g stroke="currentColor" strokeWidth="2" fill="currentColor">
          <path d="M40 66 V46" />
          <path d="M40 42 l-5 8 h10 z" />
        </g>
      )}
      <g fontSize="11" fill="currentColor" fontFamily="inherit">
        <text x="16" y="59" textAnchor="end">{value}</text>
        <text x={kind === 'thevenin' ? 90 : 122} y={kind === 'thevenin' ? 44 : 58}>{R}</text>
        <circle cx="172" cy="20" r="3.5" />
        <circle cx="172" cy="90" r="3.5" />
        <text x="180" y="24" fontWeight="700">a</text>
        <text x="180" y="94" fontWeight="700">b</text>
      </g>
    </svg>
  );
}

function PowerChart({ R, P, Rth }: { R: number[]; P: number[]; Rth: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const k = P.indexOf(Math.max(...P));
    const c = new Chart(ref.current!, {
      type: 'line',
      data: {
        datasets: [
          { label: 'P_L', data: R.map((r, i) => ({ x: r, y: P[i] })), borderColor: '#2557d6', pointRadius: 0, borderWidth: 2 },
          { label: 'tepe', data: [{ x: R[k], y: P[k] }], borderColor: '#d92d20', backgroundColor: '#d92d20', pointRadius: 5, showLine: false },
        ],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        parsing: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { type: 'logarithmic', title: { display: true, text: 'R_L' }, ticks: { callback: (v) => formatEng(Number(v), 'Ω'), maxTicksLimit: 5 } },
          y: { title: { display: true, text: 'P_L' }, ticks: { callback: (v) => formatEng(Number(v), 'W') } },
        },
      },
    });
    return () => c.destroy();
  }, [R, P, Rth]);
  return (
    <div className="mini-chart">
      <canvas ref={ref} />
    </div>
  );
}

function TheveninCard({ card }: { card: Extract<Card, { tool: 'thevenin' | 'req' }> }) {
  const { nl, err } = useNetlist();
  const { mode, label } = useMode();
  const setTheorem = useStore((s) => s.setTheorem);
  const [showMax, setShowMax] = useState(false);
  const loads = nl.elements.filter((e) => [...e.nodes].sort().join() === [card.a, card.b].sort().join());
  const th = useMemo(() => (err ? null : thevenin(nl, card.a, card.b, mode, card.load)), [nl, err, card.a, card.b, card.load, mode]);
  if (err) return <div className="issue error">{err}</div>;
  if (!th) return null;
  const ac = mode.kind === 'ac';
  const mp = showMax ? maxPower(th) : null;
  return (
    <>
      <p className="muted small">{label}. Uçlar: a = düğüm {card.a}, b = düğüm {card.b === 0 ? '0 (toprak)' : card.b}.</p>
      {loads.length > 0 && (
        <label className="th-load">
          <span>Yük (hesaptan çıkarılır)</span>
          <select value={card.load ?? ''} onChange={(e) => setTheorem({ ...card, load: e.target.value || null })} aria-label="Yük">
            <option value="">— yok —</option>
            {loads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.id}
              </option>
            ))}
          </select>
        </label>
      )}
      {card.tool === 'req' || th.resistiveOnly ? (
        <table className="kv">
          <tbody>
            <tr>
              <th>{ac ? 'Eşdeğer empedans Z_eş' : 'Eşdeğer direnç R_eş'}</th>
              <td>{th.Zth ? zText(th.Zth, 'Ω', ac) : '∞'}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <>
          <table className="kv">
            <tbody>
              <tr>
                <th>V_th = v_ab (açık devre)</th>
                <td>{th.Vth ? (ac ? phasorText(th.Vth, 'V') : formatEng(th.Vth.re, 'V')) : '—'}</td>
              </tr>
              <tr>
                <th>I_N = i_sc (a → b kısa devre)</th>
                <td>{th.IN ? (ac ? phasorText(th.IN, 'A') : formatEng(th.IN.re, 'A')) : '—'}</td>
              </tr>
              <tr>
                <th>{ac ? 'Z_th' : 'R_th'} (test kaynağıyla)</th>
                <td>{th.Zth ? zText(th.Zth, 'Ω', ac) : '∞'}</td>
              </tr>
            </tbody>
          </table>
          {th.consistent !== null && (
            <p className={`small ${th.consistent ? 'ok-text' : 'bad-text'}`}>
              Kontrol: V_th / I_N {th.consistent ? '= R_th ✓' : '≠ R_th (sayısal sorun)'}
            </p>
          )}
          <p className="muted small">
            R_th için bağımsız kaynaklar sıfırlandı (gerilim kaynağı kısa, akım kaynağı açık), bağımlı kaynaklar devrede kaldı ve
            a–b'ye 1 A test akımı verildi.
          </p>
          <div className="mini-row">
            {th.Vth && th.Zth && <MiniCircuit kind="thevenin" value={ac ? phasorText(th.Vth, 'V') : formatEng(th.Vth.re, 'V')} R={zText(th.Zth, 'Ω', ac)} />}
            {th.IN && th.Zth && <MiniCircuit kind="norton" value={ac ? phasorText(th.IN, 'A') : formatEng(th.IN.re, 'A')} R={zText(th.Zth, 'Ω', ac)} />}
          </div>
        </>
      )}
      {th.notes.map((n, i) => (
        <div key={i} className="issue info">
          {n}
        </div>
      ))}
      {card.tool === 'thevenin' && th.Vth && (
        <button className="btn" onClick={() => setShowMax(!showMax)}>
          {showMax ? 'Maksimum gücü gizle' : 'Maksimum güç aktarımı'}
        </button>
      )}
      {mp && !mp.ok && <div className="issue warning">{mp.message}</div>}
      {mp?.ok && (
        <div className="maxp">
          <table className="kv">
            <tbody>
              <tr>
                <th>{ac ? 'Z_L = Z_th*' : 'R_L = R_th'}</th>
                <td>{zText(mp.ZL!, 'Ω', ac)}</td>
              </tr>
              <tr>
                <th>P_max</th>
                <td>{formatEng(mp.Pmax!, 'W')}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">{mp.note}</p>
          {mp.sweep && <PowerChart R={mp.sweep.R} P={mp.sweep.P} Rth={th.Zth!.re} />}
        </div>
      )}
    </>
  );
}

function SuperCard({ card }: { card: Extract<Card, { tool: 'super' }> }) {
  const { nl, err } = useNetlist();
  const { mode, label } = useMode();
  const setDimmed = useStore((s) => s.setDimmed);
  const dimmed = useStore((s) => s.dimmed);
  const r = useMemo(() => (err ? null : superposition(nl, card.target, mode)), [nl, err, card.target, mode]);
  if (err) return <div className="issue error">{err}</div>;
  if (!r) return null;
  if ('error' in r) return <div className="issue warning">{r.error}</div>;
  const ac = mode.kind === 'ac';
  const v = (z: Complex, u: string) => (ac ? phasorText(z, u) : formatEng(z.re, u));
  return (
    <>
      <p className="muted small">
        {label}. Her bağımsız kaynak tek başına çalıştırıldı (diğer gerilim kaynakları kısa, akım kaynakları açık); bağımlı kaynaklar hep
        devrede kaldı. Bir satıra dokunun: sıfırlanan kaynaklar soluk görünür.
      </p>
      <table className="grid-table">
        <thead>
          <tr>
            <th>Açık kaynak</th>
            <th>v_{card.target}</th>
            <th>i_{card.target}</th>
            <th>{ac ? 'P ort.' : 'P'}</th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((row) => (
            <tr
              key={row.source}
              className={`clickable ${dimmed.join() === row.zeroed.join() && dimmed.length ? 'row-on' : ''}`}
              onClick={() => setDimmed(row.zeroed)}
            >
              <td>
                <b>{row.source}</b>
              </td>
              <td>{v(row.V, 'V')}</td>
              <td>{v(row.I, 'A')}</td>
              <td>{formatEng(row.P, 'W')}</td>
            </tr>
          ))}
          <tr className="sum-row">
            <td>Toplam</td>
            <td>{v(r.sumV, 'V')}</td>
            <td>{v(r.sumI, 'A')}</td>
            <td>{formatEng(r.sumP, 'W')}</td>
          </tr>
          <tr className="clickable" onClick={() => setDimmed([])}>
            <td>
              <b>Tam çözüm</b>
            </td>
            <td>{v(r.full.V, 'V')}</td>
            <td>{v(r.full.I, 'A')}</td>
            <td>{formatEng(r.full.P, 'W')}</td>
          </tr>
        </tbody>
      </table>
      {Math.hypot(r.sumV.re - r.full.V.re, r.sumV.im - r.full.V.im) <= 1e-6 * Math.max(1, Math.hypot(r.full.V.re, r.full.V.im)) &&
      Math.hypot(r.sumI.re - r.full.I.re, r.sumI.im - r.full.I.im) <= 1e-6 * Math.max(1, Math.hypot(r.full.I.re, r.full.I.im)) ? (
        <p className="small ok-text">Gerilim ve akım katkılarının toplamı tam çözüme eşit ✓</p>
      ) : (
        <p className="small bad-text">Gerilim ve akım katkılarının toplamı tam çözümden farklı (doğrusal olmayan / sabit ofset etkisi).</p>
      )}
      <div className="issue info">
        Güç süperpozisyonla toplanmaz: katkıların güçleri toplamı {formatEng(r.sumP, 'W')}, gerçek güç {formatEng(r.full.P, 'W')}. Güç akımın
        karesiyle orantılı olduğu için doğrusal değildir.
      </div>
    </>
  );
}

function TransformCard({ card }: { card: Extract<Card, { tool: 'transform' }> }) {
  const { nl, err } = useNetlist();
  const components = useStore((s) => s.doc.components);
  const wires = useStore((s) => s.doc.wires);
  const replace = useStore((s) => s.replaceCircuit);
  const setTheorem = useStore((s) => s.setTheorem);
  const select = useStore((s) => s.select);
  const [msg, setMsg] = useState<string | null>(null);
  const cands = useMemo(() => transformCandidates(nl, card.source), [nl, card.source]);
  const t = useMemo(() => (err ? null : sourceTransform(nl, card.source, { resistor: card.resistor })), [nl, err, card.source, card.resistor]);
  const before = useMemo(() => (t?.ok ? dcValues(nl) : null), [t, nl]);
  const after = useMemo(() => (t?.ok && t.netlist ? dcValues(t.netlist) : null), [t]);
  if (err) return <div className="issue error">{err}</div>;
  if (!t) return null;
  const others = nl.elements.filter((e) => e.id !== t.source && e.id !== t.resistor && e.type !== 'VM');
  return (
    <>
      {cands.length > 1 && (
        <label className="th-load">
          <span>Dönüşüme giren direnç</span>
          <select value={card.resistor ?? ''} onChange={(e) => setTheorem({ ...card, resistor: e.target.value || undefined })}>
            <option value="">— seçin —</option>
            {cands.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      )}
      {!t.ok ? (
        <div className="issue warning">{t.message}</div>
      ) : (
        <>
          <p className="eq small">{t.text}</p>
          {before && after && others.length > 0 && (
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Eleman</th>
                  <th>Önce V / I</th>
                  <th>Sonra V / I</th>
                </tr>
              </thead>
              <tbody>
                {others.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <b>{e.id}</b>
                    </td>
                    <td>
                      {formatEng(before[e.id].V, 'V')} / {formatEng(before[e.id].I, 'A')}
                    </td>
                    <td>
                      {formatEng(after[e.id].V, 'V')} / {formatEng(after[e.id].I, 'A')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">Devrenin geri kalanındaki gerilim ve akımlar değişmez; dönüşüm yalnızca a–b uçlarından görünüşü korur.</p>
          <button
            className="btn primary"
            onClick={() => {
              const r = applySourceTransform(components, wires, nl, t);
              if (!r) return setMsg('Çizimde uygulanamadı.');
              // güvenlik: çizimden yeniden kurulan devre aynı sonucu vermeli
              const check = dcValues(buildNetlist(r.components, r.wires));
              const ok =
                check &&
                before &&
                others.every((e) => check[e.id] && Math.abs(check[e.id].V - before[e.id].V) < 1e-6 * Math.max(1, Math.abs(before[e.id].V)));
              if (!ok) return setMsg('Dönüşüm çizimde güvenle uygulanamadı (yerleşim çakışıyor). Sonuçlar yukarıdaki tabloda.');
              replace(r.components, r.wires);
              setTheorem(null);
              select({ kind: 'comp', id: r.newId });
            }}
          >
            Devrede uygula (Ctrl+Z ile geri alınır)
          </button>
          {msg && <div className="issue warning">{msg}</div>}
        </>
      )}
    </>
  );
}

const TITLES: Record<Card['tool'], string> = {
  transform: 'Kaynak dönüşümü (5.2)',
  super: 'Süperpozisyon (5.3)',
  thevenin: 'Thevenin ve Norton (5.4–5.5)',
  req: 'Eşdeğer direnç',
};

export function TheoremPanel() {
  const card = useStore((s) => s.theorem);
  const setTheorem = useStore((s) => s.setTheorem);
  if (!card) return null;
  return (
    <div className="theorem-card">
      <div className="theorem-head">
        <span className="badge">{TITLES[card.tool]}</span>
        <button className="icon-btn" aria-label="Kapat" onClick={() => setTheorem(null)}>
          ✕
        </button>
      </div>
      {card.tool === 'super' && <p className="small">Seçili bileşen: <b>{card.target}</b></p>}
      {card.tool === 'transform' && <p className="small">Kaynak: <b>{card.source}</b></p>}
      {card.tool === 'super' && <SuperCard card={card} />}
      {card.tool === 'transform' && <TransformCard card={card} />}
      {(card.tool === 'thevenin' || card.tool === 'req') && <TheveninCard card={card} />}
    </div>
  );
}
