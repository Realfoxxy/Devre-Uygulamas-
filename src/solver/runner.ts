// Ana iş parçacığından çözücüyü çağırır: önce Web Worker, olmazsa doğrudan.
import type { AnalysisSettings } from '../core/circuit';
import type { Netlist } from '../core/netlist';
import type { AnalyzeOutput } from '../core/results';
import { analyze } from './analyze';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (o: AnalyzeOutput) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id, out, error } = ev.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(out);
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('Worker hatası'));
      pending.clear();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

export function runAnalysis(netlist: Netlist, settings: AnalysisSettings): Promise<AnalyzeOutput> {
  const w = getWorker();
  if (!w) return Promise.resolve(analyze(netlist, settings));
  const id = ++seq;
  return new Promise<AnalyzeOutput>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, netlist, settings });
  }).catch(() => analyze(netlist, settings));
}
