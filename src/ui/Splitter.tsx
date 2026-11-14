// Panelleri sürükleyerek büyütüp küçültmek için tutamaç.
import { useEffect, useState } from 'react';

export function usePersistentSize(key: string, initial: number) {
  const [v, setV] = useState<number>(() => {
    try {
      const s = Number(localStorage.getItem(`devre-lab:boyut:${key}`));
      return s > 0 ? s : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`devre-lab:boyut:${key}`, String(Math.round(v)));
    } catch {
      /* yok say */
    }
  }, [key, v]);
  return [v, setV] as const;
}

/**
 * dir = 'x': yatay sürükleme (sütun genişliği), 'y': dikey (yükseklik).
 * sign = +1 ise imleç sağa/aşağı gidince değer büyür, -1 ise küçülür.
 */
export function Splitter({
  dir,
  sign,
  value,
  min,
  max,
  onChange,
  onReset,
  className,
  label,
}: {
  dir: 'x' | 'y';
  sign: 1 | -1;
  value: number;
  min: number;
  max: () => number;
  onChange: (v: number) => void;
  onReset: () => void;
  className?: string;
  label: string;
}) {
  const [active, setActive] = useState(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = dir === 'x' ? e.clientX : e.clientY;
    const startV = value;
    setActive(true);
    const move = (ev: PointerEvent) => {
      const d = (dir === 'x' ? ev.clientX : ev.clientY) - start;
      onChange(Math.max(min, Math.min(max(), startV + sign * d)));
      window.dispatchEvent(new Event('resize'));
    };
    const up = () => {
      setActive(false);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div
      className={`splitter splitter-${dir} ${active ? 'active' : ''} ${className ?? ''}`}
      role="separator"
      aria-orientation={dir === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={Math.round(max())}
      title={`${label} — sürükleyin, çift tıklayınca varsayılan boyut`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        const keys = dir === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
        if (e.key === keys[0] || e.key === keys[1]) {
          e.preventDefault();
          e.stopPropagation();
          const d = (e.key === keys[1] ? 1 : -1) * sign * step;
          onChange(Math.max(min, Math.min(max(), value + d)));
        }
      }}
    />
  );
}
