// Hazır örnek devreler (lab föylerindeki tipik deneyler).
import type { CircuitDoc } from './circuit';
import { DEFAULT_ANALYSIS } from './circuit';

const base = (deney: string): Pick<CircuitDoc, 'version' | 'meta' | 'measured'> => ({
  version: 1,
  meta: { deney },
  measured: {},
});

export const EXAMPLES: { name: string; doc: CircuitDoc }[] = [
  {
    name: 'Gerilim bölücü (DC)',
    doc: {
      ...base('Gerilim Bölücü'),
      components: [
        { id: 'V1', type: 'V', x: 6, y: 8, rot: 90, params: { mode: 'DC', value: 12, amp: 5, freq: 1000, phase: 0 } },
        { id: 'R1', type: 'R', x: 12, y: 4, rot: 0, params: { value: 1000 } },
        { id: 'R2', type: 'R', x: 16, y: 8, rot: 90, params: { value: 2000 } },
        { id: 'VM1', type: 'VM', x: 21, y: 8, rot: 90, params: {} },
        { id: 'GND1', type: 'GND', x: 6, y: 12, rot: 0, params: {} },
      ],
      wires: [
        { id: 'w1', from: [6, 6], to: [6, 4] },
        { id: 'w2', from: [6, 4], to: [10, 4] },
        { id: 'w3', from: [14, 4], to: [16, 4] },
        { id: 'w4', from: [16, 4], to: [16, 6] },
        { id: 'w5', from: [16, 4], to: [21, 4] },
        { id: 'w6', from: [21, 4], to: [21, 6] },
        { id: 'w7', from: [6, 10], to: [6, 12] },
        { id: 'w8', from: [6, 12], to: [21, 12] },
        { id: 'w9', from: [16, 12], to: [16, 10] },
        { id: 'w10', from: [21, 12], to: [21, 10] },
      ],
      analysis: { ...DEFAULT_ANALYSIS, type: 'dc' },
    },
  },
  {
    name: 'RC şarj (geçici rejim)',
    doc: {
      ...base('RC Devresi Şarj'),
      components: [
        { id: 'V1', type: 'V', x: 6, y: 8, rot: 90, params: { mode: 'DC', value: 10, amp: 5, freq: 1000, phase: 0 } },
        { id: 'R1', type: 'R', x: 12, y: 4, rot: 0, params: { value: 1000 } },
        { id: 'C1', type: 'C', x: 16, y: 8, rot: 90, params: { value: 100e-6, v0: 0 } },
        { id: 'GND1', type: 'GND', x: 6, y: 12, rot: 0, params: {} },
      ],
      wires: [
        { id: 'w1', from: [6, 6], to: [6, 4] },
        { id: 'w2', from: [6, 4], to: [10, 4] },
        { id: 'w3', from: [14, 4], to: [16, 4] },
        { id: 'w4', from: [16, 4], to: [16, 6] },
        { id: 'w5', from: [6, 10], to: [6, 12] },
        { id: 'w6', from: [6, 12], to: [16, 12] },
        { id: 'w7', from: [16, 12], to: [16, 10] },
      ],
      analysis: { ...DEFAULT_ANALYSIS, type: 'transient' },
    },
  },
  {
    name: 'RC alçak geçiren filtre (AC + Bode)',
    doc: {
      ...base('RC Alçak Geçiren Filtre'),
      components: [
        { id: 'V1', type: 'V', x: 6, y: 8, rot: 90, params: { mode: 'AC', value: 0, amp: 5, freq: 159.15, phase: 0 } },
        { id: 'R1', type: 'R', x: 12, y: 4, rot: 0, params: { value: 1000 } },
        { id: 'C1', type: 'C', x: 16, y: 8, rot: 90, params: { value: 1e-6, v0: 0 } },
        { id: 'GND1', type: 'GND', x: 6, y: 12, rot: 0, params: {} },
      ],
      wires: [
        { id: 'w1', from: [6, 6], to: [6, 4] },
        { id: 'w2', from: [6, 4], to: [10, 4] },
        { id: 'w3', from: [14, 4], to: [16, 4] },
        { id: 'w4', from: [16, 4], to: [16, 6] },
        { id: 'w5', from: [6, 10], to: [6, 12] },
        { id: 'w6', from: [6, 12], to: [16, 12] },
        { id: 'w7', from: [16, 12], to: [16, 10] },
      ],
      analysis: { ...DEFAULT_ANALYSIS, type: 'ac', sweep: true, fStart: 1, fStop: 100000 },
    },
  },
  {
    name: 'RL devresi (geçici rejim)',
    doc: {
      ...base('RL Devresi'),
      components: [
        { id: 'V1', type: 'V', x: 6, y: 8, rot: 90, params: { mode: 'DC', value: 10, amp: 5, freq: 1000, phase: 0 } },
        { id: 'R1', type: 'R', x: 12, y: 4, rot: 0, params: { value: 100 } },
        { id: 'L1', type: 'L', x: 16, y: 8, rot: 90, params: { value: 0.1, i0: 0 } },
        { id: 'AM1', type: 'AM', x: 11, y: 12, rot: 180, params: {} },
        { id: 'GND1', type: 'GND', x: 6, y: 14, rot: 0, params: {} },
      ],
      wires: [
        { id: 'w1', from: [6, 6], to: [6, 4] },
        { id: 'w2', from: [6, 4], to: [10, 4] },
        { id: 'w3', from: [14, 4], to: [16, 4] },
        { id: 'w4', from: [16, 4], to: [16, 6] },
        { id: 'w5', from: [6, 10], to: [6, 14] },
        { id: 'w6', from: [6, 12], to: [9, 12] },
        { id: 'w7', from: [13, 12], to: [16, 12] },
        { id: 'w8', from: [16, 12], to: [16, 10] },
      ],
      analysis: { ...DEFAULT_ANALYSIS, type: 'transient' },
    },
  },
  {
    name: 'Bağımlı kaynaklı yükselteç (VCVS)',
    doc: {
      ...base('Gerilim Kontrollü Gerilim Kaynağı'),
      components: [
        { id: 'V1', type: 'V', x: 4, y: 8, rot: 90, params: { mode: 'DC', value: 2, amp: 5, freq: 1000, phase: 0 } },
        { id: 'VM1', type: 'VM', x: 10, y: 8, rot: 90, params: {} },
        { id: 'E1', type: 'E', x: 18, y: 8, rot: 90, params: { gain: 5, ctrl: { ref: 'VM1', kind: 'V' } } },
        { id: 'R1', type: 'R', x: 25, y: 8, rot: 90, params: { value: 1000 } },
        { id: 'GND1', type: 'GND', x: 4, y: 13, rot: 0, params: {} },
      ],
      wires: [
        { id: 'w1', from: [4, 6], to: [10, 6] },
        { id: 'w2', from: [18, 6], to: [25, 6] },
        { id: 'w3', from: [4, 10], to: [10, 10] },
        { id: 'w4', from: [10, 10], to: [18, 10] },
        { id: 'w5', from: [18, 10], to: [25, 10] },
        { id: 'w6', from: [4, 10], to: [4, 13] },
      ],
      analysis: { ...DEFAULT_ANALYSIS, type: 'dc' },
    },
  },
  {
    name: 'Süperdüğümlü devre (düğüm analizi)',
    doc: {
      ...base('Süperdüğüm'),
      components: [
        { id: 'V1', type: 'V', x: 4, y: 8, rot: 90, params: { mode: 'DC', value: 10, amp: 5, freq: 1000, phase: 0 } },
        { id: 'R1', type: 'R', x: 9, y: 4, rot: 0, params: { value: 2 } },
        { id: 'V2', type: 'V', x: 17, y: 4, rot: 0, params: { mode: 'DC', value: 4, amp: 5, freq: 1000, phase: 0 } },
        { id: 'R2', type: 'R', x: 13, y: 8, rot: 90, params: { value: 4 } },
        { id: 'R3', type: 'R', x: 21, y: 8, rot: 90, params: { value: 4 } },
        { id: 'GND1', type: 'GND', x: 4, y: 13, rot: 0, params: {} },
      ],
      wires: [
        { id: 'w1', from: [4, 6], to: [4, 4] },
        { id: 'w2', from: [4, 4], to: [7, 4] },
        { id: 'w3', from: [11, 4], to: [13, 4] },
        { id: 'w4', from: [13, 4], to: [15, 4] },
        { id: 'w5', from: [13, 4], to: [13, 6] },
        { id: 'w6', from: [19, 4], to: [21, 4] },
        { id: 'w7', from: [21, 4], to: [21, 6] },
        { id: 'w8', from: [4, 10], to: [4, 12] },
        { id: 'w9', from: [4, 12], to: [13, 12] },
        { id: 'w10', from: [13, 12], to: [21, 12] },
        { id: 'w11', from: [13, 12], to: [13, 10] },
        { id: 'w12', from: [21, 12], to: [21, 10] },
        { id: 'w13', from: [4, 12], to: [4, 13] },
      ],
      analysis: { ...DEFAULT_ANALYSIS, type: 'dc' },
    },
  },
  {
    name: 'Wheatstone köprüsü (DC)',
    doc: {
      ...base('Wheatstone Köprüsü'),
      components: [
        { id: 'V1', type: 'V', x: 4, y: 10, rot: 90, params: { mode: 'DC', value: 10, amp: 5, freq: 1000, phase: 0 } },
        { id: 'R1', type: 'R', x: 12, y: 6, rot: 90, params: { value: 1000 } },
        { id: 'R2', type: 'R', x: 12, y: 14, rot: 90, params: { value: 2200 } },
        { id: 'R3', type: 'R', x: 22, y: 6, rot: 90, params: { value: 1500 } },
        { id: 'R4', type: 'R', x: 22, y: 14, rot: 90, params: { value: 3300 } },
        { id: 'VM1', type: 'VM', x: 17, y: 10, rot: 0, params: {} },
        { id: 'GND1', type: 'GND', x: 4, y: 18, rot: 0, params: {} },
      ],
      wires: [
        { id: 'w1', from: [4, 8], to: [4, 2] },
        { id: 'w2', from: [4, 2], to: [22, 2] },
        { id: 'w3', from: [12, 2], to: [12, 4] },
        { id: 'w4', from: [22, 2], to: [22, 4] },
        { id: 'w5', from: [12, 8], to: [12, 12] },
        { id: 'w6', from: [22, 8], to: [22, 12] },
        { id: 'w7', from: [12, 10], to: [15, 10] },
        { id: 'w8', from: [19, 10], to: [22, 10] },
        { id: 'w9', from: [4, 12], to: [4, 18] },
        { id: 'w10', from: [4, 18], to: [22, 18] },
        { id: 'w11', from: [12, 18], to: [12, 16] },
        { id: 'w12', from: [22, 18], to: [22, 16] },
      ],
      analysis: { ...DEFAULT_ANALYSIS, type: 'dc' },
    },
  },
];
