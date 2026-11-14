// Sağ panel: seçili bileşenin özellikleri, sonuçları, ölçülen değer ve yüzde hata;
// seçim yoksa tüm devrenin sonuç özeti.
import { useEffect, useState } from 'react';
import { Component, PARTS } from '../core/circuit';
import { describeValue } from '../core/netlist';
import type { AnalysisResult } from '../core/results';
import { formatEng, percentError } from '../core/units';
import { isStale, useStore } from '../state/store';
import { SolutionView } from './SolutionView';
import { DependentFields } from './DependentFields';
import { TheoremPanel } from './TheoremCard';
import { KclPanel, KvlPanel, SeriesParallelPanel } from './KirchhoffPanels';
import { ValueInput } from './ValueInput';
import { compDisplay, nodeText } from './values';

function Issues() {
  const issues = useStore((s) => s.issues);
  const info = useStore((s) => s.resultsInfo);
  const select = useStore((s) => s.select);
  if (!issues.length && !info.length) return null;
  return (
    <div className="issues">
      {issues.map((i, k) => (
        <div key={k} className={`issue ${i.level}`}>
          <span>{i.message}</span>
          {i.compIds.length > 0 && (
            <span className="issue-links">
              {i.compIds.map((id) => (
                <button key={id} className="link" onClick={() => select({ kind: 'comp', id })}>
                  {id}
                </button>
              ))}
            </span>
          )}
        </div>
      ))}
      {info.map((t, k) => (
        <div key={`i${k}`} className="issue info">
          {t}
        </div>
      ))}
    </div>
  );
}

function ParamEditor({ comp }: { comp: Component }) {
  const update = useStore((s) => s.updateParams);
  const rename = useStore((s) => s.renameComponent);
  const rotate = useStore((s) => s.rotateSelected);
  const del = useStore((s) => s.deleteSelection);
  const [name, setName] = useState(comp.id);
  const [nameErr, setNameErr] = useState<string | null>(null);
  useEffect(() => {
    setName(comp.id);
    setNameErr(null);
  }, [comp.id]);
  const p = comp.params;
  const def = PARTS[comp.type];
  const set = (k: keyof typeof p) => (v: number | undefined) => update(comp.id, { [k]: v ?? 0 });

  const rows: JSX.Element[] = [];
  if (comp.type === 'R' || comp.type === 'C' || comp.type === 'L') {
    const lbl = comp.type === 'R' ? 'Direnç' : comp.type === 'C' ? 'Kapasitans' : 'İndüktans';
    rows.push(
      <label key="v">
        <span>{lbl}</span>
        <ValueInput value={p.value} unit={def.unit} onCommit={set('value')} autoFocusEvent positive />
      </label>,
    );
    if (comp.type === 'C')
      rows.push(
        <label key="v0">
          <span>Başlangıç gerilimi</span>
          <ValueInput value={p.v0 ?? 0} unit="V" onCommit={set('v0')} />
        </label>,
      );
    if (comp.type === 'L')
      rows.push(
        <label key="i0">
          <span>Başlangıç akımı</span>
          <ValueInput value={p.i0 ?? 0} unit="A" onCommit={set('i0')} />
        </label>,
      );
  }
  if (comp.type === 'V' || comp.type === 'I') {
    const u = def.unit;
    rows.push(
      <label key="mode">
        <span>Tür</span>
        <span className="seg">
          {(['DC', 'AC'] as const).map((m) => (
            <button key={m} className={p.mode === m ? 'on' : ''} onClick={() => update(comp.id, { mode: m })}>
              {m === 'DC' ? 'DC' : 'AC (sinüs)'}
            </button>
          ))}
        </span>
      </label>,
    );
    if (p.mode === 'AC') {
      rows.push(
        <label key="amp">
          <span>Genlik (tepe)</span>
          <ValueInput value={p.amp} unit={u} onCommit={set('amp')} autoFocusEvent />
        </label>,
        <label key="f">
          <span>Frekans</span>
          <ValueInput value={p.freq} unit="Hz" onCommit={set('freq')} positive />
        </label>,
        <label key="ph">
          <span>Faz</span>
          <ValueInput value={p.phase ?? 0} unit="°" onCommit={set('phase')} />
        </label>,
      );
    } else
      rows.push(
        <label key="v">
          <span>Değer</span>
          <ValueInput value={p.value} unit={u} onCommit={set('value')} autoFocusEvent />
        </label>,
      );
  }

  return (
    <div className="editor">
      <div className="editor-head">
        <span className="badge">{def.name}</span>
        <input
          className={`name-input ${nameErr ? 'bad' : ''}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const err = rename(comp.id, name);
            setNameErr(err);
            if (err) setName(comp.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          }}
          aria-label="Bileşen adı"
        />
      </div>
      {nameErr && <div className="field-err">{nameErr}</div>}
      <p className="muted small">{def.help}</p>
      <div className="fields">
        {rows}
        <DependentFields comp={comp} />
      </div>
      {(comp.type === 'V' || comp.type === 'I') && p.mode === 'AC' && (
        <p className="muted small">
          {comp.type === 'V' ? 'v' : 'i'}(t) = {formatEng(p.amp ?? 0, def.unit)} · sin(2π·{formatEng(p.freq ?? 0, 'Hz')}·t
          {p.phase ? ` + ${p.phase}°` : ''})
        </p>
      )}
      <div className="row-btns">
        <button className="btn" onClick={rotate} title="Döndür (R)">⟳ Döndür</button>
        <button className="btn danger" onClick={del} title="Sil (Delete)">Sil</button>
      </div>
    </div>
  );
}

function Measured({ comp, res }: { comp: Component; res: AnalysisResult }) {
  const measured = useStore((s) => s.doc.measured[comp.id]);
  const setMeasured = useStore((s) => s.setMeasured);
  const acMeasure = useStore((s) => s.doc.analysis.acMeasure);
  const tIndex = useStore((s) => s.tIndex);
  const d = compDisplay(res, comp.id, comp.type, tIndex, acMeasure);
  if (!d || comp.type === 'GND') return null;
  const showV = comp.type !== 'AM';
  const showI = comp.type !== 'VM';
  const err = (m: number | undefined, c: number | null) => (m === undefined || c === null ? null : percentError(m, c));
  const eV = err(measured?.V, d.cmpV);
  const eI = err(measured?.I, d.cmpI);
  const suffix = res.kind === 'ac' ? (acMeasure === 'rms' ? ' (etkin)' : ' (tepe)') : '';
  const errClass = (e: number | null) => (e === null ? '' : e <= 5 ? 'ok' : e <= 10 ? 'mid' : 'bad');
  return (
    <div className="measured">
      <div className="panel-title">Lab ölçümü</div>
      {showV && (
        <label>
          <span>Ölçülen V{suffix}</span>
          <ValueInput value={measured?.V} unit="V" allowEmpty placeholder="ör. 7.9" onCommit={(v) => setMeasured(comp.id, { V: v })} />
          <span className="calc">hesap: {formatEng(d.cmpV ?? 0, 'V')}</span>
          {eV !== null && <span className={`err ${errClass(eV)}`}>%{eV.toFixed(2)} hata</span>}
        </label>
      )}
      {showI && (
        <label>
          <span>Ölçülen I{suffix}</span>
          <ValueInput value={measured?.I} unit="A" allowEmpty placeholder="ör. 4m" onCommit={(v) => setMeasured(comp.id, { I: v })} />
          <span className="calc">hesap: {formatEng(d.cmpI ?? 0, 'A')}</span>
          {eI !== null && <span className={`err ${errClass(eI)}`}>%{eI.toFixed(2)} hata</span>}
        </label>
      )}
      <p className="muted small">% hata = |ölçülen − hesaplanan| / |hesaplanan| × 100</p>
    </div>
  );
}

function CompResults({ comp }: { comp: Component }) {
  const s = useStore();
  const res = s.results;
  if (!res) return <p className="muted small">Değerleri görmek için analizi çalıştırın.</p>;
  const d = compDisplay(res, comp.id, comp.type, s.tIndex, s.doc.analysis.acMeasure);
  if (!d) return <p className="muted small">Bu bileşen son analizde yoktu; yeniden çalıştırın.</p>;
  const nodes = s.resultsNetlist?.pinNodes[comp.id];
  return (
    <div className={`results ${isStale(s) ? 'stale' : ''}`}>
      <div className="panel-title">
        Sonuçlar <span className="muted">· {res.kind === 'dc' ? 'DC' : res.kind === 'ac' ? `AC ${formatEng(res.freq, 'Hz')}` : 'Geçici'}</span>
      </div>
      <table className="kv">
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.label}>
              <th>{r.label}</th>
              <td>
                {r.value}
                {r.hint && <div className="hint">{r.hint}</div>}
              </td>
            </tr>
          ))}
          {nodes && comp.type !== 'GND' && (
            <tr>
              <th>Düğümler</th>
              <td>
                + {nodes[0]} / − {nodes[1]}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="muted small">Pasif işaret kuralı: akım + uçtan girerse pozitif. Ok, gerçek akım yönünü gösterir.</p>
      <KvlPanel key={comp.id} compId={comp.id} />
      <Measured comp={comp} res={res} />
    </div>
  );
}

function Summary() {
  const s = useStore();
  const res = s.results;
  const comps = s.doc.components.filter((c) => c.type !== 'GND');
  if (!res || !s.resultsNetlist) {
    return (
      <div className="summary">
        <p className="muted">
          Bir bileşene tıklayarak değerini düzenleyin. Analizi çalıştırdıktan sonra her bileşenin gerilim, akım ve gücünü burada
          görürsünüz.
        </p>
        <ol className="steps">
          <li>Paletten bileşenleri yerleştirin ve kablolarla bağlayın.</li>
          <li>Değerleri girin (4k7, 10m, 100u…).</li>
          <li>En az bir toprak (GND) ekleyin.</li>
          <li>Analiz türünü seçip <b>Çalıştır</b>'a basın.</li>
          <li>Bileşenlere tıklayın; ölçtüğünüz değerleri girin.</li>
          <li><b>PDF rapor</b> ile çıktıyı alın.</li>
        </ol>
      </div>
    );
  }
  const nl = s.resultsNetlist;
  return (
    <div className={`summary ${isStale(s) ? 'stale' : ''}`}>
      <div className="panel-title">Düğüm gerilimleri</div>
      <table className="kv">
        <tbody>
          <tr>
            <th>0 (toprak)</th>
            <td>0 V</td>
          </tr>
          {Array.from({ length: nl.nodeCount }, (_, i) => i + 1).map((k) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{nodeText(res, k, s.tIndex)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="panel-title">Bileşenler</div>
      <table className="grid-table">
        <thead>
          <tr>
            <th>Ad</th>
            <th>Değer</th>
            <th>Gerilim</th>
            <th>Akım</th>
          </tr>
        </thead>
        <tbody>
          {comps.map((c) => {
            const d = compDisplay(res, c.id, c.type, s.tIndex, s.doc.analysis.acMeasure);
            const V = d?.rows.find((r) => r.label.startsWith('Gerilim'))?.value ?? '—';
            const I = d?.rows.find((r) => r.label.startsWith('Akım'))?.value ?? '—';
            return (
              <tr key={c.id} onClick={() => s.select({ kind: 'comp', id: c.id })} className="clickable">
                <td>
                  <b>{c.id}</b>
                </td>
                <td>{describeValue(c.type, c.params)}</td>
                <td>{V}</td>
                <td>{I}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ResultPanel() {
  const sel = useStore((s) => s.selection);
  const comp = useStore((s) => (s.selection?.kind === 'comp' ? s.doc.components.find((c) => c.id === s.selection!.id) : undefined));
  const showSolution = useStore((s) => s.showSolution);
  const del = useStore((s) => s.deleteSelection);
  const group = useStore((s) => s.group);
  const [tab, setTab] = useState<'props' | 'solution'>('props');
  const setSolutionOpen = useStore((s) => s.setSolutionOpen);
  useEffect(() => {
    if (!showSolution) setTab('props');
  }, [showSolution]);
  useEffect(() => {
    setSolutionOpen(showSolution && tab === 'solution');
  }, [showSolution, tab, setSolutionOpen]);

  return (
    <div className="result-panel">
      {showSolution && (
        <div className="tabs">
          <button className={tab === 'props' ? 'on' : ''} onClick={() => setTab('props')}>
            Özellikler
          </button>
          <button className={tab === 'solution' ? 'on' : ''} onClick={() => setTab('solution')}>
            Çözüm
          </button>
        </div>
      )}
      <Issues />
      <TheoremPanel />
      {tab === 'solution' && showSolution ? (
        <SolutionView />
      ) : group ? (
        <div className="editor">
          <span className="badge">Çoklu seçim</span>
          <p>
            <b>{group.comps.length}</b> bileşen, <b>{group.wires.length}</b> kablo seçili.
          </p>
          {group.comps.length > 0 && <p className="muted small">{group.comps.join(', ')}</p>}
          <p className="muted small">
            Seçili bir öğeyi sürükleyerek hepsini birlikte taşıyın. Shift + tık ile seçime ekleyip çıkarabilirsiniz.
          </p>
          <SeriesParallelPanel ids={group.comps} />
          <button className="btn danger" onClick={del}>
            Seçilenleri sil
          </button>
        </div>
      ) : comp ? (
        <>
          <ParamEditor comp={comp} />
          <CompResults comp={comp} />
        </>
      ) : sel?.kind === 'wire' ? (
        <div className="editor">
          <span className="badge">Kablo</span>
          <KclPanel wireId={sel.id} />
          <p className="muted small">Kabloyu silmek için Delete tuşuna basın. Kablodan sürükleyerek yeni kablo çekebilirsiniz.</p>
          <button className="btn danger" onClick={del}>
            Kabloyu sil
          </button>
        </div>
      ) : (
        <Summary />
      )}
    </div>
  );
}
