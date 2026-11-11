// Çözücünün ürettiği sonuç nesnesi: her bileşen için V, I, P ve seriler.
import type { Complex } from './complex';
import type { AnalysisSettings } from './circuit';
import type { Issue } from './netlist';

/** "Çözümü göster" modu için kurulan MNA sistemi. Karmaşık hücreler [re, im]. */
export interface SystemDump {
  labels: string[];
  A: (number | [number, number])[][];
  b: (number | [number, number])[];
  x: (number | [number, number])[];
  /** Her bileşenin damgasının düştüğü hücreler */
  owners: Record<string, { cells: [number, number][]; rhs: number[] }>;
  complex: boolean;
  note: string;
}

export interface DCComp {
  V: number;
  I: number;
  P: number;
}

export interface DCResult {
  kind: 'dc';
  nodeV: number[];
  comps: Record<string, DCComp>;
  system: SystemDump;
}

export interface ACComp {
  V: Complex;
  I: Complex;
  /** Pasif elemanlar için empedans */
  Z?: Complex;
  /** Ortalama güç Re(V·I*)/2 */
  P: number;
}

export interface ACSweep {
  f: number[];
  nodeV: Complex[][];
  comps: Record<string, { V: Complex[]; I: Complex[] }>;
  /** Kazanç için referans kaynak (ilk AC gerilim kaynağı) */
  refId: string | null;
}

export interface ACResult {
  kind: 'ac';
  freq: number;
  nodeV: Complex[];
  comps: Record<string, ACComp>;
  sweep?: ACSweep;
  system: SystemDump;
}

export interface TranResult {
  kind: 'transient';
  t: Float64Array;
  /** nodeV[düğüm][adım] */
  nodeV: Float64Array[];
  comps: Record<string, { V: Float64Array; I: Float64Array }>;
  /** Kapasitör ve bobinler için zaman sabiti */
  tau: Record<string, number>;
  h: number;
  tStop: number;
  method: 'be' | 'trap';
  system: SystemDump;
}

export type AnalysisResult = DCResult | ACResult | TranResult;

export interface AnalyzeOutput {
  ok: boolean;
  result?: AnalysisResult;
  issues: Issue[];
  settings: AnalysisSettings;
  /** Kullanılan gerçek ayarlar (ör. otomatik zaman adımı) */
  info: string[];
}
