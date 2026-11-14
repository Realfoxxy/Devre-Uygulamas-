import { useEffect, useRef, useState } from 'react';
import { formatInput, parseValue } from '../core/units';

/** Birim önekli değer girişi: 4k7, 10m, 100u, 2.2n … */
export function ValueInput({
  value,
  onCommit,
  unit,
  allowEmpty,
  placeholder,
  autoFocusEvent,
  positive,
}: {
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  unit?: string;
  allowEmpty?: boolean;
  placeholder?: string;
  autoFocusEvent?: boolean;
  positive?: boolean;
}) {
  const [text, setText] = useState(formatInput(value));
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  /** Son kaydedilen değer: Enter ardından gelen blur aynı değeri ikinci kez kaydetmesin (çift geri alma adımı) */
  const lastRef = useRef(value);
  useEffect(() => {
    lastRef.current = value;
    setText(formatInput(value));
    setBad(false);
  }, [value]);
  useEffect(() => {
    if (!autoFocusEvent) return;
    const h = () => {
      ref.current?.focus();
      ref.current?.select();
    };
    window.addEventListener('devre:edit-value', h);
    return () => window.removeEventListener('devre:edit-value', h);
  }, [autoFocusEvent]);

  const commit = () => {
    if (text.trim() === '') {
      if (allowEmpty) {
        setBad(false);
        if (lastRef.current !== undefined) onCommit(undefined);
        lastRef.current = undefined;
      } else setText(formatInput(value));
      return;
    }
    const v = parseValue(text);
    if (v === null || (positive && !(v > 0))) {
      setBad(true);
      return;
    }
    setBad(false);
    if (v !== lastRef.current) onCommit(v);
    lastRef.current = v;
    setText(formatInput(v));
  };

  return (
    <span className={`value-input ${bad ? 'bad' : ''}`}>
      <input
        ref={ref}
        value={text}
        placeholder={placeholder}
        inputMode="text"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            setText(formatInput(value));
            (e.target as HTMLInputElement).blur();
          }
          e.stopPropagation();
        }}
        title={bad ? 'Geçersiz değer. Örnek: 4k7, 10m, 100u, 2.2n' : undefined}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}
