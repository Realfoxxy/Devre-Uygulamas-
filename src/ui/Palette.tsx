// Bileşen paleti: sürükleyip bırakma ya da tıklayıp yerleştirme.
import { CompType, PALETTE_ORDER, PARTS } from '../core/circuit';
import { useStore } from '../state/store';
import { canvasApi } from './Canvas';
import { PartIcon } from './parts/symbols';

const GROUPS = ['Pasif', 'Kaynaklar', 'Bağımlı kaynaklar', 'Op-amp ve dönüştürücüler', 'Anahtarlar', 'Ölçü aletleri'] as const;

export function Palette({ onPicked }: { onPicked?: () => void }) {
  const placing = useStore((s) => s.placing);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);

  const startDrag = (type: CompType, e: React.PointerEvent) => {
    e.preventDefault();
    const rot = PARTS[type].defaultRot;
    useStore.getState().setPlacing({ type, rot });
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) moved = true;
      canvasApi.ghostAtClient?.(ev.clientX, ev.clientY);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) {
        const cur = useStore.getState().placing;
        const placed = canvasApi.placeAtClient?.(type, cur?.rot ?? rot, ev.clientX, ev.clientY);
        useStore.getState().setPlacing(null);
        if (placed) onPicked?.();
      } else {
        // tıklama: çizim alanında yerleştirme modunda kal
        onPicked?.();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="palette">
      <div className="panel-title">Bileşenler</div>
      {GROUPS.map((g) => (
        <div key={g} className="palette-group">
          <div className="palette-group-title">{g}</div>
          <div className="palette-grid">
            {PALETTE_ORDER.filter((t) => PARTS[t].group === g).map((t) => (
              <button
                key={t}
                className={`palette-item ${placing?.type === t ? 'active' : ''}`}
                onPointerDown={(e) => startDrag(t, e)}
                title={`${PARTS[t].name}: ${PARTS[t].help}`}
              >
                <PartIcon type={t} />
                <span className="pi-name">{PARTS[t].short ?? PARTS[t].name}</span>
                <span className="pi-abbr">{PARTS[t].prefix}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <button className={`palette-item wide ${tool === 'wire' ? 'active' : ''}`} onClick={() => { setTool(tool === 'wire' ? 'select' : 'wire'); onPicked?.(); }}>
        <svg width="40" height="20" viewBox="0 0 40 20" aria-hidden>
          <polyline points="4,16 20,16 20,4 36,4" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="4" cy="16" r="2.5" fill="currentColor" />
          <circle cx="36" cy="4" r="2.5" fill="currentColor" />
        </svg>
        <span className="pi-name">Kablo</span>
        <span className="pi-abbr">W</span>
      </button>
      <div className="palette-help">
        <div className="panel-title">Kısayollar</div>
        <ul>
          <li>Sol tık sürükle: alan seç</li>
          <li>Sağ tık sürükle: haritayı kaydır</li>
          <li><kbd>Shift</kbd>+tık: seçime ekle / çıkar</li>
          <li>Kablodan sürükle: yeni kablo (T bağlantısı)</li>
          <li><kbd>Ctrl</kbd>+<kbd>A</kbd> tümünü seç</li>
          <li><kbd>R</kbd> döndür</li>
          <li><kbd>W</kbd> kablo modu</li>
          <li><kbd>Del</kbd> sil</li>
          <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd> geri al / yinele</li>
          <li><kbd>Esc</kbd> iptal</li>
          <li><kbd>F5</kbd> / <kbd>Ctrl</kbd>+<kbd>Enter</kbd> çalıştır</li>
        </ul>
        <p className="muted small">
          Ölçüm için: bileşene tıklayın ya da devreye <b>voltmetre</b> (iki nokta arası gerilim) veya seri <b>ampermetre</b> (dal akımı) ekleyin.
        </p>
      </div>
    </div>
  );
}
