// Bileşen ve kablo veri modeli. Koordinatlar ızgara birimindedir.

export type CompType = 'R' | 'C' | 'L' | 'V' | 'I' | 'GND' | 'VM' | 'AM' | 'E' | 'F' | 'G' | 'H';

/** Bağımlı kaynaklar: E (VCVS), H (CCVS), G (VCCS), F (CCCS) */
export const DEPENDENT: CompType[] = ['E', 'F', 'G', 'H'];
export const isDependent = (t: CompType) => t === 'E' || t === 'F' || t === 'G' || t === 'H';
/** Bağımlı kaynağın kontrol türü: gerilim (E, G) ya da akım (F, H) */
export const ctrlKindOf = (t: CompType): 'V' | 'I' => (t === 'E' || t === 'G' ? 'V' : 'I');
export type Pt = [number, number];

export interface Params {
  /** R: Ω, C: F, L: H, V/I DC: V/A */
  value?: number;
  /** Kaynaklar için: DC ya da AC (sinüs) */
  mode?: 'DC' | 'AC';
  /** AC tepe genlik */
  amp?: number;
  /** AC frekans (Hz) */
  freq?: number;
  /** AC faz (°) */
  phase?: number;
  /** Kapasitör başlangıç gerilimi (V) */
  v0?: number;
  /** Bobin başlangıç akımı (A) */
  i0?: number;
  /** Bağımlı kaynak kazancı (A, R_m, G ya da B) */
  gain?: number;
  /** Bağımlı kaynağın kontrol büyüklüğü: başka bir bileşenin gerilimi (V) ya da akımı (I) */
  ctrl?: { ref: string; kind: 'V' | 'I' };
}

export interface Component {
  id: string;
  type: CompType;
  x: number;
  y: number;
  rot: number; // 0, 90, 180, 270
  params: Params;
}

export interface Wire {
  id: string;
  from: Pt;
  to: Pt;
}

export type AnalysisType = 'dc' | 'ac' | 'transient';

export interface AnalysisSettings {
  type: AnalysisType;
  /** AC: analiz frekansı (Hz). null → kaynakların frekansı kullanılır */
  freq: number | null;
  /** AC frekans taraması (Bode) */
  sweep: boolean;
  fStart: number;
  fStop: number;
  pointsPerDecade: number;
  /** Geçici: toplam süre (s). null → 5τ */
  tStop: number | null;
  /** Geçici: zaman adımı (s). null → en küçük τ / 50 */
  h: number | null;
  method: 'be' | 'trap';
  /** AC'de ölçülen değer hangi büyüklükle karşılaştırılır */
  acMeasure: 'rms' | 'peak';
}

export interface Measured {
  V?: number;
  I?: number;
}

export interface Meta {
  deney?: string;
  tarih?: string;
}

export interface CircuitDoc {
  version: number;
  meta: Meta;
  components: Component[];
  wires: Wire[];
  analysis: AnalysisSettings;
  measured: Record<string, Measured>;
}

export const DEFAULT_ANALYSIS: AnalysisSettings = {
  type: 'dc',
  freq: null,
  sweep: false,
  fStart: 10,
  fStop: 100000,
  pointsPerDecade: 25,
  tStop: null,
  h: null,
  method: 'be',
  acMeasure: 'rms',
};

export interface PartDef {
  type: CompType;
  name: string;
  /** Paletteki kısa ad */
  short?: string;
  /** Palet grubu */
  group: 'Pasif' | 'Kaynaklar' | 'Bağımlı kaynaklar' | 'Ölçü aletleri';
  prefix: string;
  pins: Pt[];
  defaultRot: number;
  defaultParams: Params;
  unit: string;
  shortcut?: string;
  help: string;
}

const TWO_PIN: Pt[] = [
  [-2, 0],
  [2, 0],
];

export const PARTS: Record<CompType, PartDef> = {
  R: {
    type: 'R',
    group: 'Pasif',
    name: 'Direnç',
    prefix: 'R',
    pins: TWO_PIN,
    defaultRot: 0,
    defaultParams: { value: 1000 },
    unit: 'Ω',
    help: 'Direnç (Ω)',
  },
  C: {
    type: 'C',
    group: 'Pasif',
    name: 'Kapasitör',
    prefix: 'C',
    pins: TWO_PIN,
    defaultRot: 90,
    defaultParams: { value: 1e-6, v0: 0 },
    unit: 'F',
    help: 'Kapasitans (F); DC’de açık devre',
  },
  L: {
    type: 'L',
    group: 'Pasif',
    name: 'Bobin',
    prefix: 'L',
    pins: TWO_PIN,
    defaultRot: 0,
    defaultParams: { value: 10e-3, i0: 0 },
    unit: 'H',
    help: 'İndüktans (H); DC’de kısa devre',
  },
  V: {
    type: 'V',
    group: 'Kaynaklar',
    name: 'Gerilim kaynağı',
    prefix: 'V',
    pins: TWO_PIN,
    defaultRot: 90,
    defaultParams: { mode: 'DC', value: 5, amp: 5, freq: 1000, phase: 0 },
    unit: 'V',
    help: 'DC ya da AC (sinüs) gerilim kaynağı; + ucu işaretli',
  },
  I: {
    type: 'I',
    group: 'Kaynaklar',
    name: 'Akım kaynağı',
    prefix: 'I',
    pins: TWO_PIN,
    defaultRot: 270,
    defaultParams: { mode: 'DC', value: 1e-3, amp: 1e-3, freq: 1000, phase: 0 },
    unit: 'A',
    help: 'Akım ok yönünde kaynaktan çıkar',
  },
  GND: {
    type: 'GND',
    group: 'Kaynaklar',
    name: 'Toprak',
    prefix: 'GND',
    pins: [[0, 0]],
    defaultRot: 0,
    defaultParams: {},
    unit: '',
    help: 'Referans düğüm (0 V)',
  },
  VM: {
    type: 'VM',
    group: 'Ölçü aletleri',
    name: 'Voltmetre',
    prefix: 'VM',
    pins: TWO_PIN,
    defaultRot: 90,
    defaultParams: {},
    unit: 'V',
    help: 'İdeal voltmetre: iki nokta arasındaki gerilimi ölçer (açık devre)',
  },
  AM: {
    type: 'AM',
    group: 'Ölçü aletleri',
    name: 'Ampermetre',
    prefix: 'AM',
    pins: TWO_PIN,
    defaultRot: 0,
    defaultParams: {},
    unit: 'A',
    help: 'İdeal ampermetre: içinden geçen akımı ölçer (kısa devre); seri bağlanır',
  },
  E: {
    type: 'E',
    group: 'Bağımlı kaynaklar',
    name: 'Gerilim kontrollü gerilim kaynağı',
    short: 'GKGK (E)',
    prefix: 'E',
    pins: TWO_PIN,
    defaultRot: 90,
    defaultParams: { gain: 2 },
    unit: 'V/V',
    help: 'VCVS: çıkış gerilimi = A · (seçilen bileşenin gerilimi)',
  },
  H: {
    type: 'H',
    group: 'Bağımlı kaynaklar',
    name: 'Akım kontrollü gerilim kaynağı',
    short: 'AKGK (H)',
    prefix: 'H',
    pins: TWO_PIN,
    defaultRot: 90,
    defaultParams: { gain: 100 },
    unit: 'Ω',
    help: 'CCVS: çıkış gerilimi = R_m · (seçilen bileşenin akımı)',
  },
  G: {
    type: 'G',
    group: 'Bağımlı kaynaklar',
    name: 'Gerilim kontrollü akım kaynağı',
    short: 'GKAK (G)',
    prefix: 'G',
    pins: TWO_PIN,
    defaultRot: 270,
    defaultParams: { gain: 0.01 },
    unit: 'S',
    help: 'VCCS: çıkış akımı = G · (seçilen bileşenin gerilimi); ok yönünde akar',
  },
  F: {
    type: 'F',
    group: 'Bağımlı kaynaklar',
    name: 'Akım kontrollü akım kaynağı',
    short: 'AKAK (F)',
    prefix: 'F',
    pins: TWO_PIN,
    defaultRot: 270,
    defaultParams: { gain: 2 },
    unit: 'A/A',
    help: 'CCCS: çıkış akımı = B · (seçilen bileşenin akımı); ok yönünde akar',
  },
};

export const PALETTE_ORDER: CompType[] = ['R', 'C', 'L', 'V', 'I', 'GND', 'E', 'H', 'G', 'F', 'VM', 'AM'];

/** Akım kontrolü için seçilebilen bileşenler */
export const CURRENT_CTRL_TYPES: CompType[] = ['V', 'AM', 'R', 'L', 'C', 'I', 'E', 'H'];
/** Gerilim kontrolü için seçilebilen bileşenler */
export const VOLTAGE_CTRL_TYPES: CompType[] = ['R', 'C', 'L', 'V', 'I', 'VM', 'AM', 'E', 'F', 'G', 'H'];

export function rotatePt([x, y]: Pt, rot: number): Pt {
  switch (((rot % 360) + 360) % 360) {
    case 90:
      return [-y, x];
    case 180:
      return [-x, -y];
    case 270:
      return [y, -x];
    default:
      return [x, y];
  }
}

/** Bileşen pinlerinin ızgara üzerindeki mutlak konumları. pin 0 = "+" (a) ucu. */
export function pinPositions(c: Pick<Component, 'type' | 'x' | 'y' | 'rot'>): Pt[] {
  return PARTS[c.type].pins.map((p) => {
    const [dx, dy] = rotatePt(p, c.rot);
    return [c.x + dx, c.y + dy] as Pt;
  });
}

export const ptKey = (p: Pt) => `${p[0]},${p[1]}`;
export const samePt = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/** p noktası [a,b] doğru parçasının üzerinde mi (uçlar dahil)? */
export function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) > 1e-9) return false;
  return (
    p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1])
  );
}

/** Yeni bileşen için sıradaki isim: R1, R2, … */
export function nextId(type: CompType, existing: { id: string }[]): string {
  const prefix = PARTS[type].prefix;
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const c of existing) {
    const m = re.exec(c.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${max + 1}`;
}

/** Kaynak ve pasif bileşenlerin kısa değer yazımı (etiket ve tablolar için). */
export function isSource(type: CompType) {
  return type === 'V' || type === 'I' || isDependent(type);
}
