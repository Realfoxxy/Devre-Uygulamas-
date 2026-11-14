// Üst menü ve araç çubuğu: Dosya, analiz türü ve ayarları, Çalıştır, PDF.
import { useEffect, useRef, useState } from 'react';
import type { AnalysisType } from '../core/circuit';
import { EXAMPLES } from '../core/examples';
import { useStore } from '../state/store';
import { downloadProject, openProjectFile } from '../storage/project';
import { ValueInput } from './ValueInput';

function useOutside(ref: React.RefObject<HTMLElement>, on: boolean, close: () => void) {
  useEffect(() => {
    if (!on) return;
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [on, close, ref]);
}

function FileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  const s = useStore();
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener('devre:examples', h);
    return () => window.removeEventListener('devre:examples', h);
  }, []);
  const act = (f: () => void) => () => {
    setOpen(false);
    f();
  };
  const fit = () => setTimeout(() => window.dispatchEvent(new CustomEvent('devre:fit')), 30);
  return (
    <div className="menu" ref={ref}>
      <button className="btn ghost" onClick={() => setOpen(!open)} aria-haspopup="menu">
        Dosya ▾
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <button
            onClick={act(() => {
              if (!s.doc.components.length || confirm('Mevcut devre silinsin mi? (Geri al ile dönebilirsiniz)')) s.newCircuit();
            })}
          >
            Yeni devre
          </button>
          <button
            onClick={act(async () => {
              try {
                const d = await openProjectFile();
                if (d) {
                  s.loadDoc(d);
                  fit();
                  s.showToast('Devre açıldı');
                }
              } catch (e) {
                alert((e as Error).message);
              }
            })}
          >
            Aç… (.devre)
          </button>
          <button onClick={act(() => downloadProject(s.doc))}>Kaydet (.devre indir)</button>
          <div className="menu-sep">Örnek devreler</div>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.name}
              onClick={act(() => {
                s.loadDoc(structuredClone(ex.doc));
                fit();
              })}
            >
              {ex.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalysisSettingsPop() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  const a = useStore((s) => s.doc.analysis);
  const set = useStore((s) => s.setAnalysis);
  return (
    <div className="menu" ref={ref}>
      <button className="btn ghost" onClick={() => setOpen(!open)} title="Analiz ayarları">
        ⚙ Ayarlar
      </button>
      {open && (
        <div className="menu-pop settings-pop">
          {a.type === 'dc' && <p className="muted small">DC analizde ayar yok: kapasitörler açık, bobinler kısa devre sayılır.</p>}
          {a.type === 'ac' && (
            <>
              <label>
                <span>Frekans</span>
                <ValueInput value={a.freq ?? undefined} unit="Hz" allowEmpty placeholder="kaynaktan" onCommit={(v) => set({ freq: v ?? null })} />
              </label>
              <p className="muted small">Boş bırakılırsa AC kaynakların frekansı kullanılır.</p>
              <label className="check">
                <input type="checkbox" checked={a.sweep} onChange={(e) => set({ sweep: e.target.checked })} />
                Frekans taraması (Bode)
              </label>
              {a.sweep && (
                <>
                  <label>
                    <span>Başlangıç</span>
                    <ValueInput value={a.fStart} unit="Hz" positive onCommit={(v) => set({ fStart: v ?? 10 })} />
                  </label>
                  <label>
                    <span>Bitiş</span>
                    <ValueInput value={a.fStop} unit="Hz" positive onCommit={(v) => set({ fStop: v ?? 1e5 })} />
                  </label>
                  <label>
                    <span>Nokta / dekad</span>
                    <ValueInput value={a.pointsPerDecade} positive onCommit={(v) => set({ pointsPerDecade: Math.round(v ?? 25) })} />
                  </label>
                </>
              )}
              <label>
                <span>Ölçüm karşılaştırma</span>
                <span className="seg">
                  <button className={a.acMeasure === 'rms' ? 'on' : ''} onClick={() => set({ acMeasure: 'rms' })}>Etkin (RMS)</button>
                  <button className={a.acMeasure === 'peak' ? 'on' : ''} onClick={() => set({ acMeasure: 'peak' })}>Tepe</button>
                </span>
              </label>
            </>
          )}
          {a.type === 'transient' && (
            <>
              <label>
                <span>Toplam süre</span>
                <ValueInput value={a.tStop ?? undefined} unit="s" allowEmpty placeholder="otomatik (5τ)" onCommit={(v) => set({ tStop: v ?? null })} />
              </label>
              <label>
                <span>Zaman adımı h</span>
                <ValueInput value={a.h ?? undefined} unit="s" allowEmpty placeholder="otomatik (τ/50)" onCommit={(v) => set({ h: v ?? null })} />
              </label>
              <label>
                <span>Yöntem</span>
                <span className="seg">
                  <button className={a.method === 'be' ? 'on' : ''} onClick={() => set({ method: 'be' })}>Geri Euler</button>
                  <button className={a.method === 'trap' ? 'on' : ''} onClick={() => set({ method: 'trap' })}>Trapez</button>
                </span>
              </label>
              <p className="muted small">Boş bırakılan alanlar devredeki zaman sabitinden (τ = RC, L/R) otomatik hesaplanır.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TheoremsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  const s = useStore();
  const sel = s.selection?.kind === 'comp' ? s.doc.components.find((c) => c.id === s.selection!.id) : undefined;
  const need = (msg: string) => {
    s.showToast(msg);
    setOpen(false);
  };
  const go = (f: () => void) => () => {
    setOpen(false);
    f();
    window.dispatchEvent(new CustomEvent('devre:open-panel'));
  };
  return (
    <div className="menu" ref={ref}>
      <button className="btn ghost" onClick={() => setOpen(!open)} aria-haspopup="menu">
        Teoremler ▾
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <button
            onClick={() =>
              sel && (sel.type === 'V' || sel.type === 'I')
                ? go(() => s.setTheorem({ tool: 'transform', source: sel.id }))()
                : need('Önce bir gerilim ya da akım kaynağı seçin.')
            }
          >
            Kaynak dönüşümü
          </button>
          <button
            onClick={() => (sel && sel.type !== 'GND' ? go(() => s.setTheorem({ tool: 'super', target: sel.id }))() : need('Önce sonucunu görmek istediğiniz bileşeni seçin.'))}
          >
            Süperpozisyon
          </button>
          <button
            onClick={() => {
              setOpen(false);
              s.setTheorem(null);
              s.setPickNodes({ tool: 'thevenin', a: null });
            }}
          >
            Thevenin / Norton (iki nokta seç)
          </button>
          <button
            onClick={() => {
              setOpen(false);
              s.setTheorem(null);
              s.setPickNodes({ tool: 'req', a: null });
            }}
          >
            Eşdeğer direnç (iki nokta seç)
          </button>
          <div className="menu-sep">Maksimum güç: Thevenin kartından açılır</div>
        </div>
      )}
    </div>
  );
}

export function Toolbar({ onExport, onTogglePalette, onTogglePanel }: { onExport: () => void; onTogglePalette: () => void; onTogglePanel: () => void }) {
  const s = useStore();
  const types: { v: AnalysisType; l: string }[] = [
    { v: 'dc', l: 'DC' },
    { v: 'ac', l: 'AC' },
    { v: 'transient', l: 'Geçici' },
  ];
  return (
    <header className="toolbar">
      <button className="icon-btn only-mobile" onClick={onTogglePalette} aria-label="Bileşenler">☰</button>
      <div className="brand">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="7" fill="#2557d6" />
          <path d="M4 16h5l2-5 3 10 3-10 3 10 2-5h6" fill="none" stroke="white" strokeWidth="2.4" strokeLinejoin="round" />
        </svg>
        <span className="brand-name">Devre Lab</span>
      </div>
      <FileMenu />
      <TheoremsMenu />
      <div className="tb-group hide-narrow">
        <button className="icon-btn" title="Geri al (Ctrl+Z)" disabled={!s.past.length} onClick={s.undo}>↶</button>
        <button className="icon-btn" title="Yinele (Ctrl+Y)" disabled={!s.future.length} onClick={s.redo}>↷</button>
      </div>
      <div className="tb-sep" />
      <div className="tb-analysis">
        <div className="seg analysis-seg" role="radiogroup" aria-label="Analiz türü">
          {types.map((t) => (
            <button key={t.v} className={s.doc.analysis.type === t.v ? 'on' : ''} onClick={() => s.setAnalysis({ type: t.v })}>
              {t.l}
            </button>
          ))}
        </div>
        <AnalysisSettingsPop />
        <button className="btn run" onClick={() => s.run()} disabled={s.running} title="Çalıştır (F5 / Ctrl+Enter)">
          {s.running ? '…' : '▶'} Çalıştır
        </button>
      </div>
      <div className="tb-spacer" />
      <label className="check compact hide-narrow" title="Devre üzerinde düğüm gerilimi etiketleri">
        <input type="checkbox" checked={s.showNodeLabels} onChange={(e) => s.setShowNodeLabels(e.target.checked)} />
        Düğüm etiketleri
      </label>
      <label className="check compact hide-narrow" title="Netlist ve MNA matrisini göster">
        <input type="checkbox" checked={s.showSolution} onChange={(e) => s.setShowSolution(e.target.checked)} />
        Çözümü göster
      </label>
      <button className="btn primary" onClick={onExport}>
        PDF rapor
      </button>
      <button className="icon-btn only-mobile" onClick={onTogglePanel} aria-label="Sonuç paneli">ⓘ</button>
    </header>
  );
}
