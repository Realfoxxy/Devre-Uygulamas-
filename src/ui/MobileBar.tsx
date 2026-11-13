// Telefon / tablet: bileşen seçilince altta açılan hızlı düzenleme çubuğu.
import { PARTS, isDependent } from '../core/circuit';
import { DependentFields } from './DependentFields';
import { describeValue } from '../core/netlist';
import { useStore } from '../state/store';
import { ValueInput } from './ValueInput';

export function MobileBar({ onDetails }: { onDetails: () => void }) {
  const comp = useStore((s) => (s.selection?.kind === 'comp' ? s.doc.components.find((c) => c.id === s.selection!.id) : undefined));
  const group = useStore((s) => s.group);
  const wireSel = useStore((s) => s.selection?.kind === 'wire');
  const update = useStore((s) => s.updateParams);
  const rotate = useStore((s) => s.rotateSelected);
  const del = useStore((s) => s.deleteSelection);
  const select = useStore((s) => s.select);

  if (group || wireSel) {
    return (
      <div className="mobile-bar">
        <div className="mb-head">
          <b>{group ? `${group.comps.length} bileşen, ${group.wires.length} kablo` : 'Kablo'}</b>
          <button className="icon-btn" aria-label="Seçimi kaldır" onClick={() => select(null)}>✕</button>
        </div>
        <div className="mb-actions">
          <button className="btn danger" onClick={del}>Sil</button>
        </div>
      </div>
    );
  }
  if (!comp) return null;
  const def = PARTS[comp.type];
  const p = comp.params;
  let field: JSX.Element | null = null;
  if (comp.type === 'R' || comp.type === 'C' || comp.type === 'L') {
    field = <ValueInput key={comp.id} value={p.value} unit={def.unit} positive onCommit={(v) => update(comp.id, { value: v ?? 0 })} />;
  } else if (comp.type === 'V' || comp.type === 'I') {
    field =
      p.mode === 'AC' ? (
        <ValueInput key={comp.id + 'ac'} value={p.amp} unit={`${def.unit} tepe`} onCommit={(v) => update(comp.id, { amp: v ?? 0 })} />
      ) : (
        <ValueInput key={comp.id + 'dc'} value={p.value} unit={def.unit} onCommit={(v) => update(comp.id, { value: v ?? 0 })} />
      );
  }
  return (
    <div className="mobile-bar" role="region" aria-label={`${comp.id} düzenle`}>
      <div className="mb-head">
        <span className="badge">{def.name}</span>
        <b>{comp.id}</b>
        <span className="muted small mb-desc">{comp.type === 'GND' ? '' : describeValue(comp.type, p)}</span>
        <button className="icon-btn" aria-label="Seçimi kaldır" onClick={() => select(null)}>✕</button>
      </div>
      {isDependent(comp.type) && (
        <div className="mb-dep fields">
          <DependentFields comp={comp} compact />
        </div>
      )}
      {field && (
        <label className="mb-field">
          <span>{comp.type === 'R' ? 'Direnç' : comp.type === 'C' ? 'Kapasitans' : comp.type === 'L' ? 'İndüktans' : p.mode === 'AC' ? 'Genlik' : 'Değer'}</span>
          {field}
        </label>
      )}
      <div className="mb-actions">
        <button className="btn" onClick={rotate}>⟳ Döndür</button>
        <button className="btn danger" onClick={del}>Sil</button>
        <button className="btn primary" onClick={onDetails}>Ayrıntılar / sonuçlar</button>
      </div>
    </div>
  );
}
