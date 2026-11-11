// Çözücüyü Web Worker içinde çalıştırır; ağır hesaplarda arayüz donmaz.
import type { AnalysisSettings } from '../core/circuit';
import type { Netlist } from '../core/netlist';
import { analyze } from './analyze';

self.onmessage = (ev: MessageEvent<{ id: number; netlist: Netlist; settings: AnalysisSettings }>) => {
  const { id, netlist, settings } = ev.data;
  try {
    const out = analyze(netlist, settings);
    (self as unknown as Worker).postMessage({ id, out });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
