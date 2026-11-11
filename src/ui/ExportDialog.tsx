// PDF rapor penceresi: başlık bilgileri (hatırlanır), grafik seçimi, sadece şema dışa aktarma.
import { useState } from 'react';
import { isStale, useStore } from '../state/store';
import { downloadBlob, loadReportHeader, ReportHeader, safeFileName, saveReportHeader } from '../storage/project';

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
  const [withSolution, setWithSolution] = useState(s.showSolution);
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
      const { schematicSvg, svgToPngDataUrl } = await import('../report/schematicSvg');
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
        const { buildSchematicPdf } = await import('../report/pdf');
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
          <h3>PDF rapor</h3>
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
