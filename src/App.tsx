import { useEffect, useState } from 'react';
import { useStore } from './state/store';
import { Canvas } from './ui/Canvas';
import { ExportDialog } from './ui/ExportDialog';
import { Palette } from './ui/Palette';
import { Plots } from './ui/Plots';
import { ResultPanel } from './ui/ResultPanel';
import { Toolbar } from './ui/Toolbar';

export default function App() {
  const [exportOpen, setExportOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [plotsOpen, setPlotsOpen] = useState(false);
  const results = useStore((s) => s.results);
  const toast = useStore((s) => s.toast);
  const selection = useStore((s) => s.selection);

  // Grafik üreten bir analizden sonra alt paneli aç
  useEffect(() => {
    if (results && (results.kind === 'transient' || (results.kind === 'ac' && results.sweep))) setPlotsOpen(true);
  }, [results]);

  // Telefonda bileşen seçilince sonuç çekmecesini aç
  useEffect(() => {
    if (selection && window.matchMedia('(max-width: 900px)').matches && results) setPanelOpen(true);
  }, [selection, results]);

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
      <div className="main">
        <aside className={`left drawer ${paletteOpen ? 'open' : ''}`}>
          <Palette onPicked={() => setPaletteOpen(false)} />
        </aside>
        <section className="center">
          <Canvas />
          <div className={`plots-dock ${plotsOpen ? 'open' : ''}`}>
            <button className="plots-toggle" onClick={() => setPlotsOpen((v) => !v)}>
              {plotsOpen ? '▾' : '▴'} Grafikler
            </button>
            {plotsOpen && <Plots />}
          </div>
        </section>
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
