// Düğüm / çevre denklemlerini güncel çizimden hesaplar (sonuç paneli ve çizim alanı ortak kullanır).
import { useMemo } from 'react';
import { buildNetlist } from '../core/netlist';
import { meshEquations } from '../solver/methods/mesh';
import { nodeEquations } from '../solver/methods/nodal';
import { validateControls, validateTopology } from '../solver/validate';
import { useStore } from '../state/store';

export function useMethods(enabled: boolean) {
  const components = useStore((s) => s.doc.components);
  const wires = useStore((s) => s.doc.wires);
  return useMemo(() => {
    if (!enabled) return null;
    const nl = buildNetlist(components, wires);
    const errors = [...nl.issues, ...validateControls(nl), ...validateTopology(nl, 'dc')].filter((i) => i.level === 'error');
    if (errors.length) return { nl, error: errors[0].message, node: null, mesh: null };
    try {
      return { nl, error: null, node: nodeEquations(nl), mesh: meshEquations(components, wires, nl) };
    } catch (e) {
      return { nl, error: `Denklemler kurulamadı: ${(e as Error).message}`, node: null, mesh: null };
    }
  }, [enabled, components, wires]);
}
