// Op-amp, potansiyometre, sıcaklık sensörü, iki yollu anahtar ve ölçü aletlerinin ayarları.
import { useEffect, useState } from 'react';
import { Component } from '../core/circuit';
import { formatInput, parseValue } from '../core/units';
import { useStore } from '../state/store';
import { ValueInput } from './ValueInput';

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <span className="seg">
      {options.map(([v, l]) => (
        <button key={v} type="button" className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </span>
  );
}

/** Anahtarın konum değiştirdiği anlar: "0, 1m, 3m" */
function TimesInput({ comp }: { comp: Component }) {
  const update = useStore((s) => s.updateParams);
  const times = comp.params.times ?? [];
  const [text, setText] = useState(times.map(formatInput).join(', '));
  const [bad, setBad] = useState(false);
  useEffect(() => setText((comp.params.times ?? []).map(formatInput).join(', ')), [comp.id, comp.params.times]);
  const commit = () => {
    const parts = text.split(/[,;\s]+/).filter(Boolean);
    const vals = parts.map((x) => parseValue(x));
    if (vals.some((v) => v === null)) return setBad(true);
    setBad(false);
    const times = (vals as number[]).sort((a, b) => a - b).slice(0, 50);
    // değişmediyse geri alma geçmişine boş adım eklenmez
    if (JSON.stringify(times) !== JSON.stringify(comp.params.times ?? [])) update(comp.id, { times });
  };
  return (
    <label>
      <span>Konum değiştirdiği anlar</span>
      <span className={`value-input ${bad ? 'bad' : ''}`}>
        <input
          value={text}
          placeholder="ör. 0, 1m"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          }}
          aria-label="Anahtarlama anları"
        />
        <span className="unit">s</span>
      </span>
    </label>
  );
}

export function ExtraFields({ comp, compact }: { comp: Component; compact?: boolean }) {
  const update = useStore((s) => s.updateParams);
  const p = comp.params;
  const set = (k: keyof typeof p) => (v: number | undefined) => update(comp.id, { [k]: v ?? 0 });
  switch (comp.type) {
    case 'OA': {
      const model = p.model ?? 'ideal';
      return (
        <>
          <label>
            <span>Model</span>
            <Seg value={model} options={[['ideal', 'İdeal'], ['finite', 'Sonlu kazanç'], ['offset', 'Ofsetli']]} onChange={(m) => update(comp.id, { model: m })} />
          </label>
          {!compact && model === 'finite' && (
            <>
              <label>
                <span>Açık çevrim kazancı A</span>
                <ValueInput value={p.gainA} unit="V/V" positive onCommit={set('gainA')} />
              </label>
              <label>
                <span>Giriş direnci R_i</span>
                <ValueInput value={p.rin} unit="Ω" positive onCommit={set('rin')} />
              </label>
              <label>
                <span>Çıkış direnci R_o</span>
                <ValueInput value={p.rout} unit="Ω" positive onCommit={set('rout')} />
              </label>
            </>
          )}
          {!compact && model === 'offset' && (
            <>
              <label>
                <span>Ofset gerilimi V_os</span>
                <ValueInput value={p.vos} unit="V" onCommit={set('vos')} />
              </label>
              <label>
                <span>Öngerilim akımı I_b</span>
                <ValueInput value={p.ib} unit="A" onCommit={set('ib')} />
              </label>
            </>
          )}
          {!compact && (
            <>
              <label>
                <span>Doyum gerilimi</span>
                <ValueInput value={p.vsat} unit="V" positive onCommit={set('vsat')} />
              </label>
              <label>
                <span>Doyum akımı</span>
                <ValueInput value={p.isat} unit="A" positive onCommit={set('isat')} />
              </label>
              <label>
                <span>Eğim hızı</span>
                <ValueInput value={p.slew} unit="V/s" positive onCommit={set('slew')} />
              </label>
              <p className="muted small">
                {model === 'ideal' && 'İdeal: v₊ = v₋, giriş akımları 0 (Bölüm 6.3). '}
                {model === 'finite' && 'Sonlu kazanç: girişler arasında R_i, içeride A·(v₊ − v₋), çıkışta seri R_o (Bölüm 6.7). '}
                {model === 'offset' && 'Ofsetli: + girişe seri V_os, iki girişte I_b öngerilim akımı; çekirdek ideal (Bölüm 6.7). '}
                Model ideal kalır; doyum ve eğim hızı yalnızca uyarı olarak gösterilir.
              </p>
            </>
          )}
        </>
      );
    }
    case 'POT':
      return (
        <>
          {!compact && (
            <label>
              <span>Toplam direnç R_p</span>
              <ValueInput value={p.value} unit="Ω" positive onCommit={set('value')} autoFocusEvent />
            </label>
          )}
          <label className="pot-slider">
            <span>Konum a = {(p.pos ?? 0.5).toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={p.pos ?? 0.5}
              onChange={(e) => update(comp.id, { pos: Number(e.target.value) })}
              onPointerUp={() => window.dispatchEvent(new CustomEvent('devre:rerun'))}
              onKeyUp={() => window.dispatchEvent(new CustomEvent('devre:rerun'))}
              aria-label="Potansiyometre konumu"
            />
          </label>
          {!compact && <p className="muted small">Orta uç ile alt uç arası a·R_p, üst uç ile orta uç arası (1 − a)·R_p. Parmağınızı kaldırınca devre yeniden çözülür.</p>}
        </>
      );
    case 'TS':
      return (
        <>
          <label>
            <span>Sıcaklık</span>
            <ValueInput value={p.tempC} unit="°C" onCommit={set('tempC')} autoFocusEvent={!compact} />
          </label>
          {!compact && (
            <>
              <label>
                <span>k</span>
                <ValueInput value={p.kT} unit="A/K" positive onCommit={set('kT')} />
              </label>
              <label>
                <span>Çalışma aralığı</span>
                <span className="range2">
                  <ValueInput value={p.vmin} unit="V" onCommit={set('vmin')} />
                  <ValueInput value={p.vmax} unit="V" onCommit={set('vmax')} />
                </span>
              </label>
              <p className="muted small">I = k · T, T = sıcaklık + 273.15 K (Bölüm 2.6).</p>
            </>
          )}
        </>
      );
    case 'SW2':
      return (
        <>
          <label>
            <span>t &lt; 0'da ortak uç</span>
            <Seg value={p.way ?? 'A'} options={[['A', 'A'], ['B', 'B']]} onChange={(w) => update(comp.id, { way: w })} />
          </label>
          <TimesInput comp={comp} />
        </>
      );
    case 'SW':
      return (
        <>
          <label>
            <span>t &lt; 0 konumu</span>
            <Seg value={p.sw0 ?? 'open'} options={[['open', 'Açık'], ['closed', 'Kapalı']]} onChange={(w) => update(comp.id, { sw0: w })} />
          </label>
          <TimesInput comp={comp} />
        </>
      );
    case 'VM':
    case 'AM':
      return (
        <>
          <label>
            <span>Model</span>
            <Seg value={p.real ? 'real' : 'ideal'} options={[['ideal', 'İdeal'], ['real', 'Gerçek']]} onChange={(m) => update(comp.id, { real: m === 'real' })} />
          </label>
          {p.real && !compact && (
            <label>
              <span>{comp.type === 'VM' ? 'İç direnç R_VM' : 'İç direnç R_AM'}</span>
              <ValueInput value={p.rMeter} unit="Ω" positive onCommit={set('rMeter')} />
            </label>
          )}
          {p.real && !compact && (
            <p className="muted small">
              Gerçek {comp.type === 'VM' ? 'voltmetrenin uçları arasında R_VM' : 'ampermetrede seri R_AM'} vardır; sonuç panelinde ideal değere göre
              yükleme hatası yazılır (Bölüm 2.8).
            </p>
          )}
        </>
      );
    default:
      return null;
  }
}
