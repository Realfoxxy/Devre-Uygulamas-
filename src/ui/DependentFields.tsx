// Bağımlı kaynak (E, F, G, H) için kazanç ve kontrol bileşeni seçimi.
import { Component, CURRENT_CTRL_TYPES, PARTS, VOLTAGE_CTRL_TYPES, ctrlKindOf, isDependent } from '../core/circuit';
import { useStore } from '../state/store';
import { ValueInput } from './ValueInput';

const GAIN_LABEL: Record<string, string> = { E: 'Kazanç A', H: 'Geçiş direnci R_m', G: 'Geçiş iletkenliği G', F: 'Kazanç B' };

export function DependentFields({ comp, compact }: { comp: Component; compact?: boolean }) {
  const components = useStore((s) => s.doc.components);
  const update = useStore((s) => s.updateParams);
  const setPick = useStore((s) => s.setPickCtrl);
  if (!isDependent(comp.type)) return null;
  const kind = ctrlKindOf(comp.type);
  const allowed = kind === 'V' ? VOLTAGE_CTRL_TYPES : CURRENT_CTRL_TYPES;
  const options = components.filter((c) => c.id !== comp.id && allowed.includes(c.type));
  const ref = comp.params.ctrl?.ref ?? '';
  const missing = ref && !components.some((c) => c.id === ref);
  return (
    <>
      <label>
        <span>{GAIN_LABEL[comp.type]}</span>
        <ValueInput key={comp.id + 'g'} value={comp.params.gain} unit={PARTS[comp.type].unit} onCommit={(v) => update(comp.id, { gain: v ?? 0 })} autoFocusEvent={!compact} />
      </label>
      <label>
        <span>Kontrol ({kind === 'V' ? 'gerilimi' : 'akımı'})</span>
        <span className="ctrl-pick">
          <select
            id={`ctrl-${comp.id}`}
            value={missing ? '' : ref}
            onChange={(e) => update(comp.id, { ctrl: e.target.value ? { ref: e.target.value, kind } : undefined })}
            aria-label="Kontrol bileşeni"
          >
            <option value="">— seçin —</option>
            {options.map((c) => (
              <option key={c.id} value={c.id} title={PARTS[c.type].name}>
                {c.id}
              </option>
            ))}
          </select>
          <button className="btn" type="button" onClick={() => setPick(comp.id)} title="Çizimde bir bileşene dokunarak seç">
            Devreden seç
          </button>
        </span>
      </label>
      {missing && <div className="field-err">{ref} devrede yok; kontrolü yeniden seçin.</div>}
      {!compact && (
        <p className="muted small">
          {comp.type === 'E' && 'v_çıkış = A · v_kontrol. Kitaptaki “v_a” gibi bir gerilim için oraya bir voltmetre koyup onu seçin.'}
          {comp.type === 'H' && 'v_çıkış = R_m · i_kontrol. Akım, kontrol bileşeninin + ucundan girerse pozitiftir.'}
          {comp.type === 'G' && 'i_çıkış = G · v_kontrol; akım ok yönünde kaynaktan çıkar.'}
          {comp.type === 'F' && 'i_çıkış = B · i_kontrol; akım ok yönünde kaynaktan çıkar.'}
        </p>
      )}
    </>
  );
}
