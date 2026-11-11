import { useEffect, useState } from 'react';
import { useStore } from './state/store';
import { Canvas } from './ui/Canvas';
import { ExportDialog } from './ui/ExportDialog';
import { MobileBar } from './ui/MobileBar';
import { Palette } from './ui/Palette';
import { Plots } from './ui/Plots';
import { ResultPanel } from './ui/ResultPanel';
import { Splitter, usePersistentSize } from './ui/Splitter';
import { Toolbar } from './ui/Toolbar';

export default function App() {
  const [exportOpen, setExportOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [plotsOpen, setPlotsOpen] = useState(false);
  const [leftW, setLeftW] = usePersistentSize('sol', 210);
  const [rightW, setRightW] = usePersistentSize('sag', 340);
  const [plotsH, setPlotsH] = usePersistentSize('grafik', 300);
  const maxSide = () => Math.max(260, window.innerWidth * 0.45);
  const results = useStore((s) => s.results);
  const toast = useStore((s) => s.toast);

  // Grafik üreten bir analizden sonra alt paneli aç
  useEffect(() => {
    if (results && (results.kind === 'transient' || (results.kind === 'ac' && results.sweep))) setPlotsOpen(true);
  }, [results]);

  // Telefonda çift dokunuşla bileşen düzenleme çekmecesini aç
  useEffect(() => {
    const h = () => {
      if (window.matchMedia('(max-width: 900px)').matches) setPanelOpen(true);
    };
    window.addEventListener('devre:edit-value', h);
    return () => window.removeEventListener('devre:edit-value', h);
  }, []);

  // Klavye kısayolları
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      const s = useStore.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
      } else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        s.redo();
      } else if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        s.selectAll();
      } else if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        import('./storage/project').then((m) => m.downloadProject(s.doc));
      } else if (e.key === 'F5' || (ctrl && e.key === 'Enter')) {
        e.preventDefault();
        s.run();
      } else if (ctrl) {
        return;
      } else if (e.key === 'r' || e.key === 'R') {
        s.rotateSelected();
      } else if (e.key === 'w' || e.key === 'W') {
        s.setTool(s.tool === 'wire' ? 'select' : 'wire');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        s.deleteSelection();
      } else if (e.key === 'Escape') {
        s.setPlacing(null);
        s.setTool('select');
        s.select(null);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="app">
      <Toolbar
        onExport={() => setExportOpen(true)}
        onTogglePalette={() => setPaletteOpen((v) => !v)}
        onTogglePanel={() => setPanelOpen((v) => !v)}
      />
      <div className="main" style={{ '--left-w': `${leftW}px`, '--right-w': `${rightW}px`, '--plots-h': `${plotsH}px` } as React.CSSProperties}>
        <aside className={`left drawer ${paletteOpen ? 'open' : ''}`}>
          <Palette onPicked={() => setPaletteOpen(false)} />
        </aside>
        <Splitter dir="x" sign={1} value={leftW} min={150} max={maxSide} onChange={setLeftW} onReset={() => setLeftW(210)} label="Bileşen paneli genişliği" />
        <section className="center">
          <Canvas />
          {!panelOpen && (
            <div className="only-mobile-block">
              <MobileBar onDetails={() => setPanelOpen(true)} />
            </div>
          )}
          <div className={`plots-dock ${plotsOpen ? 'open' : ''}`}>
            {plotsOpen && (
              <Splitter dir="y" sign={-1} value={plotsH} min={140} max={() => window.innerHeight * 0.75} onChange={setPlotsH} onReset={() => setPlotsH(300)} label="Grafik paneli yüksekliği" />
            )}
            <button className="plots-toggle" onClick={() => setPlotsOpen((v) => !v)}>
              {plotsOpen ? '▾' : '▴'} Grafikler
            </button>
            {plotsOpen && <Plots />}
          </div>
        </section>
        <Splitter dir="x" sign={-1} value={rightW} min={260} max={maxSide} onChange={setRightW} onReset={() => setRightW(340)} label="Sonuç paneli genişliği" />
        <aside className={`right drawer ${panelOpen ? 'open' : ''}`}>
          <button className="drawer-close only-mobile" onClick={() => setPanelOpen(false)} aria-label="Kapat">✕</button>
          <ResultPanel />
        </aside>
        {(paletteOpen || panelOpen) && <div className="scrim only-mobile" onClick={() => { setPaletteOpen(false); setPanelOpen(false); }} />}
      </div>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
