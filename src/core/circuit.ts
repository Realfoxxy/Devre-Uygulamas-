// Bileşen ve kablo veri modeli. Koordinatlar ızgara birimindedir.

export type CompType = 'R' | 'C' | 'L' | 'V' | 'I' | 'GND' | 'VM' | 'AM' | 'E' | 'F' | 'G' | 'H' | 'OA' | 'POT' | 'TS' | 'SW' | 'SW2';

/** Bağımlı kaynaklar: E (VCVS), H (CCVS), G (VCCS), F (CCCS) */
export const DEPENDENT: CompType[] = ['E', 'F', 'G', 'H'];
export const isDependent = (t: CompType) => t === 'E' || t === 'F' || t === 'G' || t === 'H';
/** Bağımlı kaynağın kontrol türü: gerilim (E, G) ya da akım (F, H) */
export const ctrlKindOf = (t: CompType): 'V' | 'I' => (t === 'E' || t === 'G' ? 'V' : 'I');
export type Pt = [number, number];

export interface Params {
  /** R: Ω, C: F, L: H, V/I DC: V/A */
  value?: number;
  /** Kaynak dalga biçimi */
  mode?: SourceMode;
  /** Dalga biçimi parametreleri: w0 / w1 iki seviye, td gecikme (t₀), pw darbe genişliği, per periyot,
   *  wk katsayı K, wb üstel katsayı b, pwl (t, değer) noktaları */
  w0?: number;
  w1?: number;
  td?: number;
  pw?: number;
  per?: number;
  wk?: number;
  wb?: number;
  pwl?: [number, number][];
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
  /** Op-amp modeli */
  model?: 'ideal' | 'finite' | 'offset';
  /** Op-amp: açık çevrim kazancı, giriş / çıkış direnci, ofset gerilimi, öngerilim akımı */
  gainA?: number;
  rin?: number;
  rout?: number;
  vos?: number;
  ib?: number;
  /** Op-amp sınırları: doyum gerilimi, doyum akımı, eğim hızı (V/s) */
  vsat?: number;
  isat?: number;
  slew?: number;
  /** Potansiyometre konumu (0–1, alt uçtan) */
  pos?: number;
  /** Sıcaklık sensörü: k (A/K), sıcaklık (°C), çalışma aralığı */
  kT?: number;
  tempC?: number;
  vmin?: number;
  vmax?: number;
  /** Ölçü aleti: gerçek model (iç direnç) */
  real?: boolean;
  rMeter?: number;
  /** İki yollu anahtar: ortak uç t < 0'da hangi konumda */
  way?: 'A' | 'B';
  /** Tek yollu anahtar: t < 0 konumu */
  sw0?: 'open' | 'closed';
  /** Anahtarın konum değiştirdiği anlar (s) */
  times?: number[];
  /** Kapasitör / bobin başlangıç koşulu: otomatik (t < 0 DC çözümünden) ya da elle */
  init?: 'auto' | 'manual';
}

export type SourceMode = 'DC' | 'AC' | 'STEP' | 'PULSE' | 'EXP' | 'RAMP' | 'SINE_U' | 'PWL';

export const SOURCE_MODES: { mode: SourceMode; label: string; formula: string }[] = [
  { mode: 'DC', label: 'DC', formula: 'K' },
  { mode: 'AC', label: 'AC (sürekli sinüs, fazör)', formula: 'A·sin(ωt + θ)' },
  { mode: 'STEP', label: 'Basamak u(t)', formula: 'V₀ (t < t₀), V₁ (t ≥ t₀)' },
  { mode: 'PULSE', label: 'Darbe / kare dalga', formula: 'V₁ ile V₂ arasında periyodik' },
  { mode: 'EXP', label: 'Üstel', formula: 'K·e^(−b(t − t₀))·u(t − t₀)' },
  { mode: 'RAMP', label: 'Rampa', formula: 'K·(t − t₀)·u(t − t₀)' },
  { mode: 'SINE_U', label: 'Anahtarlanan sinüs', formula: 'A·sin(ωt + θ)·u(t − t₀)' },
  { mode: 'PWL', label: 'Parçalı doğrusal', formula: '(t, değer) noktaları arasında doğrusal' },
];

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
  method: 'trap',
  acMeasure: 'rms',
};

export interface PartDef {
  type: CompType;
  name: string;
  /** Paletteki kısa ad */
  short?: string;
  /** Palet grubu */
  group: 'Pasif' | 'Kaynaklar' | 'Bağımlı kaynaklar' | 'Op-amp ve dönüştürücüler' | 'Anahtarlar' | 'Ölçü aletleri';
  /** Pin adları (üç uçlu elemanlar) */
  pinNames?: string[];
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
    defaultParams: { real: false, rMeter: 10e6 },
    unit: 'V',
    help: 'Voltmetre: iki nokta arasındaki gerilimi ölçer. İdealde açık devre; gerçekte iç direnci var (varsayılan 10 MΩ)',
  },
  AM: {
    type: 'AM',
    group: 'Ölçü aletleri',
    name: 'Ampermetre',
    prefix: 'AM',
    pins: TWO_PIN,
    defaultRot: 0,
    defaultParams: { real: false, rMeter: 1 },
    unit: 'A',
    help: 'Ampermetre: içinden geçen akımı ölçer; seri bağlanır. İdealde kısa devre; gerçekte iç direnci var (varsayılan 1 Ω)',
  },
  OA: {
    type: 'OA',
    group: 'Op-amp ve dönüştürücüler',
    name: 'İşlemsel yükselteç (op-amp)',
    short: 'Op-amp',
    prefix: 'OA',
    pins: [
      [-2, 1],
      [-2, -1],
      [2, 0],
    ],
    pinNames: ['+', '−', 'çıkış'],
    defaultRot: 0,
    defaultParams: { model: 'ideal', gainA: 1e5, rin: 1e6, rout: 100, vos: 5e-3, ib: 500e-9, vsat: 15, isat: 10e-3, slew: 0.5e6 },
    unit: '',
    help: 'Girişler + ve −, çıkış toprağa göre. Besleme pinleri yok; doyum yalnızca uyarı olarak gösterilir.',
  },
  POT: {
    type: 'POT',
    group: 'Op-amp ve dönüştürücüler',
    name: 'Potansiyometre',
    short: 'Potansiyometre',
    prefix: 'POT',
    pins: [
      [-2, 0],
      [2, 0],
      [0, -2],
    ],
    pinNames: ['üst uç', 'alt uç', 'orta uç'],
    defaultRot: 90,
    defaultParams: { value: 10000, pos: 0.5 },
    unit: 'Ω',
    help: 'Toplam direnç R_p; orta uç alt uçtan a·R_p uzaklıkta (a = 0–1)',
  },
  TS: {
    type: 'TS',
    group: 'Op-amp ve dönüştürücüler',
    name: 'Sıcaklık sensörü',
    short: 'Sıcaklık sensörü',
    prefix: 'TS',
    pins: TWO_PIN,
    defaultRot: 270,
    defaultParams: { kT: 1e-6, tempC: 25, vmin: 4, vmax: 30 },
    unit: 'A',
    help: 'Mutlak sıcaklıkla orantılı akım kaynağı: I = k·T (T kelvin); ok yönünde akar',
  },
  SW: {
    type: 'SW',
    group: 'Anahtarlar',
    name: 'Anahtar',
    short: 'Anahtar',
    prefix: 'SW',
    pins: TWO_PIN,
    defaultRot: 0,
    defaultParams: { sw0: 'open', times: [0] },
    unit: '',
    help: 'Tek yollu anahtar: t < 0 konumu ve konum değiştirdiği anlar (kapalı 1 mΩ, açık 1 TΩ)',
  },
  SW2: {
    type: 'SW2',
    group: 'Anahtarlar',
    name: 'İki yollu anahtar',
    short: 'İki yollu anahtar',
    prefix: 'SW',
    pins: [
      [-2, 0],
      [2, -1],
      [2, 1],
    ],
    pinNames: ['ortak', 'A', 'B'],
    defaultRot: 0,
    defaultParams: { way: 'A', times: [] },
    unit: '',
    help: 'Ortak uç A ya da B konumuna bağlanır; konum değiştirdiği anlar girilebilir (kapalı 1 mΩ, açık 1 TΩ)',
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

export const PALETTE_ORDER: CompType[] = ['R', 'C', 'L', 'V', 'I', 'GND', 'E', 'H', 'G', 'F', 'OA', 'POT', 'TS', 'SW', 'SW2', 'VM', 'AM'];

export const isSwitch = (t: CompType) => t === 'SW' || t === 'SW2';

/** Üç uçlu elemanlar */
export const isMultiPin = (t: CompType) => t === 'OA' || t === 'POT' || t === 'SW2';

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
