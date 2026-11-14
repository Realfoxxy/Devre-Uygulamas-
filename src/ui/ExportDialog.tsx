// PDF rapor penceresi: başlık bilgileri (hatırlanır), grafik seçimi, sadece şema dışa aktarma.
import { useState } from 'react';
import { AppState, isStale, useStore } from '../state/store';
import { buildNetlist } from '../core/netlist';
import { formatEng } from '../core/units';
import { nodeEquations } from '../solver/methods/nodal';
import { meshEquations } from '../solver/methods/mesh';
import { maxPower, superposition, thevenin } from '../solver/methods/theorems';
import { phasorText } from './values';
import type { ReportSections } from '../report/pdf';
import { downloadBlob, loadReportHeader, ReportHeader, safeFileName, saveReportHeader } from '../storage/project';

/** Rapor için isteğe bağlı araç bölümleri */
function buildSections(st: AppState, want: { node: boolean; mesh: boolean; theorem: boolean; dynamics: boolean }): ReportSections {
  const nl = buildNetlist(st.doc.components, st.doc.wires);
  const out: ReportSections = { dynamics: want.dynamics };
  if (want.node) out.nodeEquations = nodeEquations(nl);
  if (want.mesh) out.meshEquations = meshEquations(st.doc.components, st.doc.wires, nl);
  const card = st.theorem;
  if (want.theorem && card) {
    const mode = st.results?.kind === 'ac' ? { kind: 'ac' as const, freq: st.results.freq } : { kind: 'dc' as const };
    const ac = mode.kind === 'ac';
    const zt = (z: { re: number; im: number } | null, u: string) =>
      !z ? '—' : ac ? phasorText(z, u) : formatEng(z.re, u);
    if (card.tool === 'thevenin' || card.tool === 'req') {
      const r = thevenin(nl, card.a, card.b, mode, card.load);
      const mp = maxPower(r);
      out.thevenin = {
        a: card.a,
        b: card.b,
        Vth: zt(r.Vth, 'V'),
        IN: zt(r.IN, 'A'),
        Rth: r.Zth ? (ac ? `${formatEng(r.Zth.re, 'Ω')} ${r.Zth.im < 0 ? '−' : '+'} j${formatEng(Math.abs(r.Zth.im), 'Ω')}` : formatEng(r.Zth.re, 'Ω')) : '∞',
        notes: r.notes,
        maxPower: mp.ok ? `P_max = ${formatEng(mp.Pmax!, 'W')} (${ac ? 'Z_L = Z_th*' : `R_L = ${formatEng(mp.ZL!.re, 'Ω')}`})` : undefined,
      };
    } else if (card.tool === 'super') {
      const r = superposition(nl, card.target, mode);
      if (!('error' in r)) {
        out.superposition = {
          target: card.target,
          head: ['Açık kaynak', `v_${card.target}`, `i_${card.target}`, 'P'],
          rows: [
            ...r.rows.map((x) => [x.source!, zt(x.V, 'V'), zt(x.I, 'A'), formatEng(x.P, 'W')]),
            ['Toplam', zt(r.sumV, 'V'), zt(r.sumI, 'A'), formatEng(r.sumP, 'W')],
            ['Tam çözüm', zt(r.full.V, 'V'), zt(r.full.I, 'A'), formatEng(r.full.P, 'W')],
          ],
          note: 'Gerilim ve akım katkıları toplanır; güç akımın karesiyle orantılı olduğundan süperpozisyonla toplanmaz.',
        };
      }
    }
  }
  return out;
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const saved = loadReportHeader();
  const [h, setH] = useState<ReportHeader>({
    deney: s.doc.meta.deney || saved.deney || '',
    ogrenci: saved.ogrenci || '',
    numara: saved.numara || '',
    ders: saved.ders || '',
    tarih: s.doc.meta.tarih || new Date().toISOString().slice(0, 10),
  });
  const comps = s.doc.components.filter((c) => c.type !== 'GND');
  const sel = s.selection?.kind === 'comp' ? s.selection.id : null;
  const defaultPlots = (() => {
    const set = new Set(s.plotted);
    if (sel) set.add(sel);
    if (!set.size) comps.filter((c) => c.type === 'C' || c.type === 'L' || c.type === 'VM' || c.type === 'AM').forEach((c) => set.add(c.id));
    return [...set];
  })();
  const [plots, setPlots] = useState<string[]>(defaultPlots);
  const [withSolution, setWithSolution] = useState(s.showSolution && s.solutionTab === 'mna');
  const [withNode, setWithNode] = useState(s.showSolution && s.solutionTab === 'node');
  const [withMesh, setWithMesh] = useState(s.showSolution && s.solutionTab === 'mesh');
  const theoremUsable = s.theorem && (s.theorem.tool === 'thevenin' || s.theorem.tool === 'req' || s.theorem.tool === 'super');
  const [withTheorem, setWithTheorem] = useState(!!theoremUsable);
  const hasDyn = s.results?.kind === 'transient' && !!(s.results.firstOrder?.applicable || s.results.secondOrder?.analysis.ok);
  const [withDyn, setWithDyn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hasPlots = s.results?.kind === 'transient' || (s.results?.kind === 'ac' && !!s.results.sweep);
  const needsRun = !s.results || isStale(s);
  const fileBase = safeFileName(h.deney, 'devre');

  const field = (k: keyof ReportHeader, label: string, type = 'text') => (
    <label>
      <span>{label}</span>
      <input type={type} value={h[k]} onChange={(e) => setH({ ...h, [k]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
    </label>
  );

  const makeReport = async () => {
    setErr(null);
    setBusy(true);
    try {
      saveReportHeader(h);
      s.setMeta({ deney: h.deney, tarih: h.tarih });
      if (needsRun) await useStore.getState().run();
      const st = useStore.getState();
      if (!st.results || !st.resultsNetlist) {
        setErr('Analiz başarısız: önce sağ paneldeki hataları düzeltin.');
        return;
      }
      const { buildReport } = await import('../report/pdf');
      const doc = await buildReport({
        header: h,
        components: st.doc.components,
        wires: st.doc.wires,
        analysis: st.doc.analysis,
        measured: st.doc.measured,
        results: st.results,
        netlist: st.resultsNetlist,
        tIndex: st.tIndex,
        plotIds: plots,
        includeSolution: withSolution,
        info: st.resultsInfo,
        sections: buildSections(st, { node: withNode, mesh: withMesh, theorem: withTheorem, dynamics: withDyn }),
      });
      downloadBlob(doc.output('blob'), `${fileBase}-rapor.pdf`);
      onClose();
    } catch (e) {
      console.error(e);
      setErr(`PDF oluşturulamadı: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const schematicOnly = async (fmt: 'pdf' | 'svg' | 'png') => {
    setErr(null);
    setBusy(true);
    try {
      const { schematicSvg, svgToPngDataUrl, buildSchematicPdf } = await import('../report/pdf');
      const st = useStore.getState();
      const fresh = !isStale(st);
      const svg = schematicSvg({
        components: st.doc.components,
        wires: st.doc.wires,
        results: fresh ? st.results : null,
        netlist: fresh ? st.resultsNetlist : null,
        tIndex: st.tIndex,
        acMeasure: st.doc.analysis.acMeasure,
      });
      if (fmt === 'svg') downloadBlob(new Blob([svg.markup], { type: 'image/svg+xml' }), `${fileBase}-sema.svg`);
      else if (fmt === 'png') {
        const url = await svgToPngDataUrl(svg, 3);
        const blob = await (await fetch(url)).blob();
        downloadBlob(blob, `${fileBase}-sema.png`);
      } else {
        downloadBlob((await buildSchematicPdf(svg, h.deney)).output('blob'), `${fileBase}-sema.pdf`);
      }
    } catch (e) {
      setErr(`Dışa aktarılamadı: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="PDF rapor">
        <div className="modal-head">
          <h2>PDF rapor</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Kapat">✕</button>
        </div>
        <div className="form">
          {field('deney', 'Deney adı')}
          <div className="form-row">
            {field('ogrenci', 'Öğrenci adı')}
            {field('numara', 'Numara')}
          </div>
          <div className="form-row">
            {field('ders', 'Ders kodu')}
            {field('tarih', 'Tarih', 'date')}
          </div>
        </div>
        {hasPlots && (
          <div className="form-block">
            <div className="panel-title">Grafiğe eklenecek bileşenler</div>
            <div className="chips">
              {comps.map((c) => (
                <button
                  key={c.id}
                  className={`chip ${plots.includes(c.id) ? 'on' : ''}`}
                  onClick={() => setPlots(plots.includes(c.id) ? plots.filter((p) => p !== c.id) : [...plots, c.id])}
                >
                  {c.id}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={withNode} onChange={(e) => setWithNode(e.target.checked)} />
          Düğüm denklemleri
        </label>
        <label className="check">
          <input type="checkbox" checked={withMesh} onChange={(e) => setWithMesh(e.target.checked)} />
          Çevre denklemleri
        </label>
        {theoremUsable && (
          <label className="check">
            <input type="checkbox" checked={withTheorem} onChange={(e) => setWithTheorem(e.target.checked)} />
            Açık teorem kartı ({s.theorem!.tool === 'super' ? 'süperpozisyon' : 'Thevenin / Norton'})
          </label>
        )}
        {hasDyn && (
          <label className="check">
            <input type="checkbox" checked={withDyn} onChange={(e) => setWithDyn(e.target.checked)} />
            Birinci / ikinci derece analiz (formüller, karakteristik denklem)
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={withSolution} onChange={(e) => setWithSolution(e.target.checked)} />
          Ek olarak netlist ve MNA matrisini ekle
        </label>
        <p className="muted small">
          Rapor: başlık, devre şeması (değer etiketleriyle), analiz ayarları, sonuç tablosu
          {Object.keys(s.doc.measured).length ? ' (ölçülen değer ve % hata dahil)' : ''}, düğüm gerilimleri
          {hasPlots ? ', grafikler' : ''}.
          {needsRun && ' Sonuçlar güncel olmadığı için analiz önce yeniden çalıştırılacak.'}
        </p>
        {err && <div className="issue error">{err}</div>}
        <div className="modal-actions">
          <div className="schem-only">
            <span className="muted small">Sadece şema:</span>
            <button className="btn" disabled={busy || !s.doc.components.length} onClick={() => schematicOnly('pdf')}>PDF</button>
            <button className="btn" disabled={busy || !s.doc.components.length} onClick={() => schematicOnly('svg')}>SVG</button>
            <button className="btn" disabled={busy || !s.doc.components.length} onClick={() => schematicOnly('png')}>PNG</button>
          </div>
          <button className="btn primary" disabled={busy || !s.doc.components.length} onClick={makeReport}>
            {busy ? 'Hazırlanıyor…' : 'PDF raporu indir'}
          </button>
        </div>
      </div>
    </div>
  );
}
