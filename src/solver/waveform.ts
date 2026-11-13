// Bağımsız kaynakların zamana bağlı değeri.
import type { NetElement } from '../core/netlist';

/** Kaynağın t anındaki değeri. */
export function sourceAt(e: NetElement, t: number): number {
  const p = e.params;
  if (p.mode === 'AC') {
    return Number(p.amp ?? 0) * Math.sin(2 * Math.PI * Number(p.freq ?? 0) * t + (Number(p.phase ?? 0) * Math.PI) / 180);
  }
  return Number(p.value ?? 0);
}

/** DC analizde kullanılan değer: kaynağın t < 0 değeri (AC kaynak 0). */
export function sourceBefore(e: NetElement): number {
  if (e.params.mode === 'AC') return 0;
  return sourceAt(e, -1e-30);
}
