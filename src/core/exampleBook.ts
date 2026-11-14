// Örnekler menüsü: kitabın bölüm sırasıyla gruplanmış, her örneğe bir cümlelik açıklama ve "neye bak" ipucu.
// Örnek devreler kitaptakilerin kopyası değil, aynı türden özgün devrelerdir.
import { AnalysisSettings, CircuitDoc, Component, DEFAULT_ANALYSIS, Params, Pt, Wire } from './circuit';
import { EXAMPLES } from './examples';

export interface BookExample {
  group: string;
  name: string;
  desc: string;
  tip: string;
  doc: CircuitDoc;
}

type Part = { id: string; type: Component['type']; params?: Params };
type Item = { series: Part } | { shunt: Part; rot?: number };

/**
 * Merdiven tipi devre: solda kaynak, üst rayda seri elemanlar, üst ile alt ray arasında paralel (şönt) elemanlar.
 * Son eleman bir şönt olmalı (çevre kapanır).
 */
export function ladder(deney: string, source: Part & { rot?: number }, items: Item[], analysis: Partial<AnalysisSettings> = {}): CircuitDoc {
  const comps: Component[] = [];
  const wires: Wire[] = [];
  let wn = 0;
  const W = (a: Pt, b: Pt) => {
    if (a[0] !== b[0] || a[1] !== b[1]) wires.push({ id: `w${++wn}`, from: a, to: b });
  };
  const TOP = 4;
  const BOT = 12;
  comps.push({ id: source.id, type: source.type, x: 4, y: 8, rot: source.rot ?? (source.type === 'I' || source.type === 'TS' ? 270 : 90), params: source.params ?? {} });
  W([4, 6], [4, TOP]);
  W([4, 10], [4, BOT]);
  let x = 4;
  let lastShunt = false;
  let bottom = 4;
  for (const it of items) {
    if ('series' in it) {
      const cx = x + 3;
      comps.push({ id: it.series.id, type: it.series.type, x: cx, y: TOP, rot: 0, params: it.series.params ?? {} });
      W([x, TOP], [cx - 2, TOP]);
      x = cx + 2;
      lastShunt = false;
    } else {
      const nx = x + (lastShunt ? 6 : 2);
      W([x, TOP], [nx, TOP]);
      comps.push({ id: it.shunt.id, type: it.shunt.type, x: nx, y: 8, rot: it.rot ?? 90, params: it.shunt.params ?? {} });
      W([nx, TOP], [nx, 6]);
      W([nx, 10], [nx, BOT]);
      W([bottom, BOT], [nx, BOT]);
      bottom = nx;
      x = nx;
      lastShunt = true;
    }
  }
  comps.push({ id: 'GND1', type: 'GND', x: 4, y: BOT + 1, rot: 0, params: {} });
  W([4, BOT], [4, BOT + 1]);
  return { version: 2, meta: { deney }, measured: {}, components: comps, wires, analysis: { ...DEFAULT_ANALYSIS, ...analysis } };
}

const R = (id: string, value: number): Part => ({ id, type: 'R', params: { value } });
const V = (id: string, value: number): Part => ({ id, type: 'V', params: { mode: 'DC', value, amp: value, freq: 1000, phase: 0 } });
const I = (id: string, value: number): Part => ({ id, type: 'I', params: { mode: 'DC', value, amp: value, freq: 1000, phase: 0 } });
const Cp = (id: string, value: number, v0 = 0): Part => ({ id, type: 'C', params: { value, v0 } });
const Lp = (id: string, value: number, i0 = 0): Part => ({ id, type: 'L', params: { value, i0 } });
const ex = (name: string) => EXAMPLES.find((e) => e.name.startsWith(name))!.doc;

/** Op-amp devreleri için ortak yerleşim (eviren yükselteç düzeninden türetilir) */
function opamp(deney: string, kind: 'noninv' | 'follower' | 'sum' | 'diff', analysis: Partial<AnalysisSettings> = {}): CircuitDoc {
  const oa: Component = { id: 'OA1', type: 'OA', x: 17, y: 8, rot: 0, params: { model: 'ideal', gainA: 1e5, rin: 1e6, rout: 100, vos: 5e-3, ib: 500e-9, vsat: 15, isat: 10e-3, slew: 0.5e6 } };
  const gnd: Component = { id: 'GND1', type: 'GND', x: 4, y: 15, rot: 0, params: {} };
  const vm: Component = { id: 'VM1', type: 'VM', x: 25, y: 11, rot: 90, params: { real: false, rMeter: 10e6 } };
  let n = 0;
  const w = (a: Pt, b: Pt): Wire => ({ id: `w${++n}`, from: a, to: b });
  // ortak: çıkış (19,8) → (21,8) → VM; VM alt ucu toprak rayına
  const common: Wire[] = [w([19, 8], [21, 8]), w([21, 8], [25, 8]), w([25, 8], [25, 9]), w([25, 13], [25, 14])];
  if (kind === 'follower') {
    return {
      version: 2,
      meta: { deney },
      measured: {},
      components: [{ id: 'V1', type: 'V', x: 4, y: 11, rot: 90, params: { mode: 'DC', value: 2, amp: 2, freq: 1000, phase: 0 } }, oa, vm, gnd],
      wires: [
        ...common,
        w([4, 9], [15, 9]),
        w([15, 7], [14, 7]),
        w([14, 7], [14, 3]),
        w([14, 3], [21, 3]),
        w([21, 3], [21, 8]),
        w([4, 13], [4, 14]),
        w([4, 14], [25, 14]),
        w([4, 14], [4, 15]),
      ],
      analysis: { ...DEFAULT_ANALYSIS, ...analysis },
    };
  }
  if (kind === 'noninv') {
    return {
      version: 2,
      meta: { deney },
      measured: {},
      components: [
        { id: 'V1', type: 'V', x: 4, y: 11, rot: 90, params: { mode: 'DC', value: 1, amp: 1, freq: 1000, phase: 0 } },
        { id: 'Rg', type: 'R', x: 11, y: 7, rot: 0, params: { value: 1000 } },
        { id: 'Rf', type: 'R', x: 17, y: 3, rot: 0, params: { value: 4000 } },
        oa,
        vm,
        gnd,
      ],
      wires: [
        ...common,
        w([4, 9], [15, 9]),
        w([9, 7], [8, 7]),
        w([8, 7], [8, 14]),
        w([13, 7], [14, 7]),
        w([14, 7], [15, 7]),
        w([14, 7], [14, 3]),
        w([14, 3], [15, 3]),
        w([19, 3], [21, 3]),
        w([21, 3], [21, 8]),
        w([4, 13], [4, 14]),
        w([4, 14], [8, 14]),
        w([8, 14], [25, 14]),
        w([4, 14], [4, 15]),
      ],
      analysis: { ...DEFAULT_ANALYSIS, ...analysis },
    };
  }
  if (kind === 'sum') {
    return {
      version: 2,
      meta: { deney },
      measured: {},
      components: [
        { id: 'V1', type: 'V', x: 3, y: 9, rot: 90, params: { mode: 'DC', value: 1, amp: 1, freq: 1000, phase: 0 } },
        { id: 'V2', type: 'V', x: 7, y: 11, rot: 90, params: { mode: 'DC', value: 2, amp: 2, freq: 1000, phase: 0 } },
        { id: 'R1', type: 'R', x: 11, y: 5, rot: 0, params: { value: 10000 } },
        { id: 'R2', type: 'R', x: 11, y: 7, rot: 0, params: { value: 10000 } },
        { id: 'Rf', type: 'R', x: 17, y: 3, rot: 0, params: { value: 10000 } },
        oa,
        vm,
        gnd,
      ],
      wires: [
        ...common,
        w([3, 7], [3, 5]),
        w([3, 5], [9, 5]),
        w([7, 9], [7, 7]),
        w([7, 7], [9, 7]),
        w([13, 5], [14, 5]),
        w([14, 5], [14, 7]),
        w([13, 7], [14, 7]),
        w([14, 7], [15, 7]),
        w([14, 5], [14, 3]),
        w([14, 3], [15, 3]),
        w([19, 3], [21, 3]),
        w([21, 3], [21, 8]),
        w([15, 9], [15, 14]),
        w([3, 11], [3, 14]),
        w([7, 13], [7, 14]),
        w([3, 14], [7, 14]),
        w([7, 14], [15, 14]),
        w([15, 14], [25, 14]),
        w([4, 14], [4, 15]),
      ],
      analysis: { ...DEFAULT_ANALYSIS, ...analysis },
    };
  }
  // fark yükselteci: v_çıkış = (R2/R1)(v2 − v1)
  return {
    version: 2,
    meta: { deney },
    measured: {},
    components: [
      { id: 'V1', type: 'V', x: 3, y: 9, rot: 90, params: { mode: 'DC', value: 1, amp: 1, freq: 1000, phase: 0 } },
      { id: 'V2', type: 'V', x: 7, y: 12, rot: 90, params: { mode: 'DC', value: 3, amp: 3, freq: 1000, phase: 0 } },
      { id: 'R1', type: 'R', x: 11, y: 7, rot: 0, params: { value: 10000 } },
      { id: 'Rf', type: 'R', x: 17, y: 3, rot: 0, params: { value: 20000 } },
      { id: 'R3', type: 'R', x: 11, y: 10, rot: 0, params: { value: 10000 } },
      { id: 'R4', type: 'R', x: 15, y: 12, rot: 90, params: { value: 20000 } },
      oa,
      vm,
      gnd,
    ],
    wires: [
      ...common,
      w([3, 7], [9, 7]),
      w([13, 7], [14, 7]),
      w([14, 7], [15, 7]),
      w([14, 7], [14, 3]),
      w([14, 3], [15, 3]),
      w([19, 3], [21, 3]),
      w([21, 3], [21, 8]),
      w([7, 10], [9, 10]),
      w([13, 10], [15, 10]),
      w([15, 10], [15, 9]),
      w([3, 11], [3, 14]),
      w([7, 14], [3, 14]),
      w([7, 14], [15, 14]),
      w([15, 14], [25, 14]),
      w([4, 14], [4, 15]),
    ],
    analysis: { ...DEFAULT_ANALYSIS, ...analysis },
  };
}

function potExample(): CircuitDoc {
  let n = 0;
  const w = (a: Pt, b: Pt): Wire => ({ id: `w${++n}`, from: a, to: b });
  return {
    version: 2,
    meta: { deney: 'Potansiyometre ile Gerilim Ayarı' },
    measured: {},
    components: [
      { id: 'V1', type: 'V', x: 4, y: 8, rot: 90, params: { mode: 'DC', value: 10, amp: 10, freq: 1000, phase: 0 } },
      { id: 'POT1', type: 'POT', x: 11, y: 8, rot: 90, params: { value: 10000, pos: 0.3 } },
      { id: 'VM1', type: 'VM', x: 17, y: 10, rot: 90, params: { real: false, rMeter: 10e6 } },
      { id: 'GND1', type: 'GND', x: 4, y: 13, rot: 0, params: {} },
    ],
    wires: [
      w([4, 6], [4, 4]),
      w([4, 4], [11, 4]),
      w([11, 4], [11, 6]),
      w([13, 8], [17, 8]),
      w([11, 10], [11, 12]),
      w([4, 10], [4, 12]),
      w([4, 12], [11, 12]),
      w([11, 12], [17, 12]),
      w([4, 12], [4, 13]),
    ],
    analysis: { ...DEFAULT_ANALYSIS, type: 'dc' },
  };
}

const G1 = (ctrl: string, gain: number): Part => ({ id: 'G1', type: 'G', params: { gain, ctrl: { ref: ctrl, kind: 'V' } } });

export const BOOK: BookExample[] = [
  // Bölüm 1–2
  {
    group: 'Bölüm 1–2: Temeller',
    name: 'Pasif işaret kuralı',
    desc: 'Güç veren kaynak ve güç soğuran dirençler.',
    tip: 'Çalıştırın ve V1’e tıklayın: güç negatif (veriyor). R1 ve R2’nin gücü pozitif (soğuruyor); toplam güç 0.',
    doc: ladder('Pasif İşaret Kuralı', V('V1', 10), [{ series: R('R1', 1000) }, { shunt: R('R2', 1000) }]),
  },
  {
    group: 'Bölüm 1–2: Temeller',
    name: 'Bağımlı kaynağın gücü',
    desc: 'Gerilim kontrollü gerilim kaynağı (GKGK) ile yükselteç.',
    tip: 'E1’e tıklayın: kontrol bileşeni VM1 kesikli çizgiyle görünür; E1’in gücü negatif, yani güç veriyor.',
    doc: ex('Bağımlı kaynaklı yükselteç'),
  },
  {
    group: 'Bölüm 1–2: Temeller',
    name: 'Sıcaklık sensörü',
    desc: 'Mutlak sıcaklıkla orantılı akım veren dönüştürücü.',
    tip: 'TS1’in sıcaklığını değiştirip yeniden çalıştırın: R1 gerilimi I = k·T ile değişir (25 °C’de 2.98 V).',
    doc: ladder('Sıcaklık Sensörü', { id: 'TS1', type: 'TS', params: { kT: 1e-6, tempC: 25, vmin: 1, vmax: 30 } }, [{ shunt: R('R1', 10000) }]),
  },
  {
    group: 'Bölüm 1–2: Temeller',
    name: 'Potansiyometre',
    desc: 'Konumla ayarlanan gerilim bölücü.',
    tip: 'POT1’i seçip kaydırıcıyı oynatın: orta uç gerilimi a·10 V olur.',
    doc: potExample(),
  },
  // Bölüm 3
  {
    group: 'Bölüm 3: Dirençli devreler',
    name: 'Gerilim bölücü',
    desc: 'Seri iki direnç ve voltmetre.',
    tip: 'Shift ile R1 ve R2’yi seçin: seri eşdeğer ve gerilim bölücü formülü sağ panelde.',
    doc: ex('Gerilim bölücü'),
  },
  {
    group: 'Bölüm 3: Dirençli devreler',
    name: 'Akım bölücü',
    desc: 'Akım kaynağına paralel iki direnç.',
    tip: 'Shift ile R1 ve R2’yi seçin: paralel eşdeğer ve akım bölücü formülü görünür.',
    doc: ladder('Akım Bölücü', I('I1', 3e-3), [{ shunt: R('R1', 1000) }, { shunt: R('R2', 2000) }]),
  },
  {
    group: 'Bölüm 3: Dirençli devreler',
    name: 'Seri / paralel indirgeme',
    desc: 'Adım adım indirgenebilen merdiven devresi.',
    tip: 'Önce R3 ile R4’ü (seri), sonra sonucu R2 ile birlikte düşünün; bir kabloya dokununca KAY tablosu çıkar.',
    doc: ladder('Seri Paralel İndirgeme', V('V1', 12), [{ series: R('R1', 1000) }, { shunt: R('R2', 2000) }, { series: R('R3', 1000) }, { shunt: R('R4', 1000) }]),
  },
  // Bölüm 4
  {
    group: 'Bölüm 4: Analiz yöntemleri',
    name: 'Süperdüğümlü devre',
    desc: 'Toprağa bağlı olmayan gerilim kaynağı.',
    tip: '“Çözümü göster” → Düğüm denklemleri: süperdüğüm {2, 3} çizimde çerçeveli, kısıt v2 − v3 = 4.',
    doc: ex('Süperdüğümlü devre'),
  },
  {
    group: 'Bölüm 4: Analiz yöntemleri',
    name: 'Süperçevreli devre',
    desc: 'İki çevre arasında akım kaynağı.',
    tip: '“Çözümü göster” → Çevre denklemleri: süperçevre {i1, i2} ve kısıt satırı.',
    doc: ladder('Süperçevre', V('V1', 10), [{ series: R('R1', 2) }, { shunt: I('I1', 2), rot: 270 }, { series: R('R3', 4) }, { shunt: R('R4', 4) }]),
  },
  {
    group: 'Bölüm 4: Analiz yöntemleri',
    name: 'Bağımlı kaynaklı düğüm analizi',
    desc: 'Gerilim kontrollü akım kaynağı (GKAK) içeren devre.',
    tip: 'Düğüm denklemlerinde kontrol gerilimi ayrı satırda tanımlanır (v_R2 = v2).',
    doc: ladder('Bağımlı Kaynaklı Düğüm Analizi', V('V1', 12), [{ series: R('R1', 1000) }, { shunt: R('R2', 2000) }, { series: R('R3', 3000) }, { shunt: { ...G1('R2', 0.001), id: 'G1' }, rot: 270 }, { shunt: R('R4', 500) }]),
  },
  // Bölüm 5
  {
    group: 'Bölüm 5: Teoremler',
    name: 'Kaynak dönüşümü',
    desc: 'Gerilim kaynağı + seri direnç ↔ akım kaynağı ∥ direnç.',
    tip: 'V1’i seçip Teoremler → Kaynak dönüşümü: yük akımı iki durumda da 1.333 A.',
    doc: ladder('Kaynak Dönüşümü', V('V1', 12), [{ series: R('R1', 3) }, { shunt: R('RL', 6) }]),
  },
  {
    group: 'Bölüm 5: Teoremler',
    name: 'Süperpozisyon',
    desc: 'Bir gerilim ve bir akım kaynağı.',
    tip: 'R2’yi seçip Teoremler → Süperpozisyon: katkıların toplamı tam çözüme eşit, güç toplanmaz.',
    doc: ladder('Süperpozisyon', V('V1', 10), [{ series: R('R1', 2) }, { shunt: R('R2', 4) }, { shunt: I('I1', 2), rot: 270 }, { shunt: R('R3', 4) }]),
  },
  {
    group: 'Bölüm 5: Teoremler',
    name: 'Bağımlı kaynaklı Thevenin',
    desc: 'Bağımlı kaynak R_th’yi değiştirir.',
    tip: 'Teoremler → Thevenin: a ve b için G1’in iki ucuna dokunun. R_th = 1.333 Ω (bağımlı kaynak sıfırlansaydı 2 Ω).',
    doc: ex('Bağımlı kaynaklı Thevenin'),
  },
  {
    group: 'Bölüm 5: Teoremler',
    name: 'Köprü (eşdeğer direnç)',
    desc: 'Seri / paralele indirgenemeyen köprü.',
    tip: 'Teoremler → Eşdeğer direnç ile iki noktaya dokunun; voltmetre köprü dengesini gösterir.',
    doc: ex('Wheatstone köprüsü'),
  },
  {
    group: 'Bölüm 5: Teoremler',
    name: 'Maksimum güç aktarımı',
    desc: 'Yük direnci R_th’ye eşitken güç en büyük.',
    tip: 'Thevenin’i RL’nin uçlarında açın, yük olarak RL’yi seçin, “Maksimum güç” ile grafiği görün.',
    doc: ladder('Maksimum Güç Aktarımı', V('V1', 12), [{ series: R('R1', 4) }, { shunt: R('RL', 10) }]),
  },
  // Bölüm 6
  {
    group: 'Bölüm 6: Op-amp',
    name: 'Eviren yükselteç',
    desc: 'Kazanç −R_f / R_1.',
    tip: 'OA1’e tıklayın: v₊ = v₋ (sanal kısa devre), çıkış −5 V.',
    doc: ex('Eviren yükselteç'),
  },
  { group: 'Bölüm 6: Op-amp', name: 'Evirmeyen yükselteç', desc: 'Kazanç 1 + R_f / R_g.', tip: 'Çıkış 1 V · (1 + 4k/1k) = 5 V.', doc: opamp('Evirmeyen Yükselteç', 'noninv') },
  { group: 'Bölüm 6: Op-amp', name: 'Gerilim izleyici', desc: 'Kazanç 1, giriş akımı 0.', tip: 'Çıkış girişe eşit; kaynaktan akım çekilmez.', doc: opamp('Gerilim İzleyici', 'follower') },
  { group: 'Bölüm 6: Op-amp', name: 'Toplayıcı', desc: 'Çıkış −(v1 + v2) (eşit dirençler).', tip: '1 V + 2 V → çıkış −3 V.', doc: opamp('Toplayıcı', 'sum') },
  { group: 'Bölüm 6: Op-amp', name: 'Fark yükselteci', desc: 'Çıkış (R_f/R_1)(v2 − v1).', tip: '(20k/10k)·(3 V − 1 V) = 4 V.', doc: opamp('Fark Yükselteci', 'diff') },
  {
    group: 'Bölüm 6: Op-amp',
    name: 'Sonlu kazanç karşılaştırması',
    desc: 'Aynı eviren yükselteç, gerçekçi op-amp modeliyle.',
    tip: 'Çalıştırınca not satırında ideal modele göre yüzde fark yazar (%0.011).',
    doc: (() => {
      const d = structuredClone(ex('Eviren yükselteç'));
      d.meta.deney = 'Sonlu Kazançlı Op-amp';
      d.components = d.components.map((c) => (c.type === 'OA' ? { ...c, params: { ...c.params, model: 'finite' } } : c));
      return d;
    })(),
  },
  // Bölüm 7
  {
    group: 'Bölüm 7: C ve L',
    name: 'Anahtarlı devrede 0⁻ / 0⁺',
    desc: 'Anahtar açılınca bobin akımı direnç üzerinden döner.',
    tip: 'Geçici rejimi çalıştırın: 0⁻/0⁺ tablosunda i_L sürekli, R2 gerilimi 0’dan 20 V’a sıçrıyor; τ = 5 µs.',
    doc: ladder('Anahtarlı Devrede Başlangıç Koşulları', V('V1', 10), [{ series: { id: 'SW1', type: 'SW', params: { sw0: 'closed', times: [0] } } }, { series: R('R1', 1000) }, { shunt: Lp('L1', 10e-3) }, { shunt: R('R2', 2000) }], { type: 'transient', tStop: 30e-6 }),
  },
  {
    group: 'Bölüm 7: C ve L',
    name: 'Seri / paralel C ve L',
    desc: 'Paralel kapasitörler toplanır.',
    tip: 'Shift ile C1 ve C2’yi seçin: paralel eşdeğer 5 µF; kuralın dirençlerin tersi olduğu yazar.',
    doc: ladder('Paralel Kapasitörler', V('V1', 5), [{ series: R('R1', 1000) }, { shunt: Cp('C1', 2e-6) }, { shunt: Cp('C2', 3e-6) }], { type: 'transient' }),
  },
  { group: 'Bölüm 7: C ve L', name: 'Op-amp integratör', desc: 'Geri beslemede kapasitör.', tip: 'Not satırında v_çıkış = −(1/RC)∫v_giriş dt; basamaktan sonra çıkış doğrusal iner.', doc: ex('Op-amp integratör') },
  // Bölüm 8
  { group: 'Bölüm 8: Birinci derece', name: 'RC şarjı', desc: 'Kapasitör kaynaktan dirençle dolar.', tip: 'Grafikte τ, 3τ, 5τ çizgileri; kartta v_C(t) formülü.', doc: ex('RC şarj') },
  { group: 'Bölüm 8: Birinci derece', name: 'RL devresi', desc: 'Bobin akımı L/R zaman sabitiyle yükselir.', tip: 'Ampermetre bobin akımını gösterir; τ = L/R = 1 ms.', doc: ex('RL devresi') },
  { group: 'Bölüm 8: Birinci derece', name: 'Ardışık anahtarlama', desc: 't = 0’da dolar, 1 ms’de boşalır.', tip: 'Formül kartında iki aralık: ikinci aralığın başlangıcı birincinin son değeri (6.32 V).', doc: ex('Anahtarlı RC') },
  { group: 'Bölüm 8: Birinci derece', name: 'Darbe girişi', desc: 'Kare dalga ile tekrarlı dolma / boşalma.', tip: 'C1’i seçip enerji imleçleriyle bir aralıkta soğurulan enerjiyi ölçün.', doc: ex('Kare dalga girişli RC') },
  {
    group: 'Bölüm 8: Birinci derece',
    name: 'Kararsız devre',
    desc: 'Bağımlı kaynak R_th’yi negatif yapar.',
    tip: 'R_th = −2 Ω: doğal yanıt büyür, simülasyon değerler 10⁶ katına çıkınca durur.',
    doc: ladder('Kararsız Devre', V('Vs', 1), [{ series: R('R1', 2) }, { shunt: Cp('C1', 1e-6) }, { shunt: { id: 'VM1', type: 'VM', params: {} } }, { shunt: G1('VM1', 1), rot: 270 }], { type: 'transient', tStop: 4e-5 }),
  },
  // Bölüm 9
  { group: 'Bölüm 9: İkinci derece', name: 'Seri RLC (üç sönüm türü)', desc: 'R ile sönüm türü değişir.', tip: 'İkinci derece kartında R1’i seçip kaydırıcıyla oynatın: 400 Ω aşırı, 200 Ω kritik, 100 Ω az sönümlü.', doc: ex('Seri RLC') },
  {
    group: 'Bölüm 9: İkinci derece',
    name: 'Paralel RLC',
    desc: 'Akım kaynaklı paralel RLC; s² + 3s + 2 = 0.',
    tip: 'Kökler −1 ve −2: aşırı sönümlü; kitabın paralel RLC formülü kartta.',
    doc: ladder('Paralel RLC', I('I1', 1), [{ shunt: R('R1', 2 / 3) }, { shunt: Lp('L1', 1) }, { shunt: Cp('C1', 0.5) }], { type: 'transient', tStop: 8, method: 'trap' }),
  },
  {
    group: 'Bölüm 9: İkinci derece',
    name: 'Kare dalga girişli RLC',
    desc: 'Darbe girişinde salınımlı bobin akımı.',
    tip: 'L1’i seçin: ilk tepe yaklaşık 363 ns’de 232.6 mA, son değer 200 mA.',
    doc: ladder('Kare Dalga Girişli RLC', { id: 'V1', type: 'V', params: { mode: 'PULSE', w0: 0, w1: 20, td: 0, pw: 2e-6, per: 4e-6, value: 0, amp: 20, freq: 1000, phase: 0 } }, [{ series: R('R1', 100) }, { shunt: Cp('C1', 1e-9) }, { shunt: Lp('L1', 10e-6) }], { type: 'transient', tStop: 8e-6, method: 'trap', h: 2e-9 }),
  },
  {
    group: 'Bölüm 9: İkinci derece',
    name: 'Üstel girişli tam yanıt',
    desc: 'i_s = 8e^(−2t) A ile paralel RLC.',
    tip: 'İkinci derece kartında çıkış olarak i_L1’i seçin: zorlanmış kısım −12e^(−2t) A.',
    doc: ladder('Üstel Girişli Tam Yanıt', { id: 'I1', type: 'I', params: { mode: 'EXP', wk: 8, wb: 2, td: 0, value: 0, amp: 8, freq: 1000, phase: 0 } }, [{ shunt: R('R1', 6) }, { shunt: Lp('L1', 7) }, { shunt: Cp('C1', 1 / 42) }], { type: 'transient', tStop: 6, method: 'trap' }),
  },
  // AC (Devre Teorisi II'ye hazırlık)
  { group: 'AC analiz (ek)', name: 'RC alçak geçiren filtre', desc: 'Fazör analizi ve Bode grafiği.', tip: 'C1’e tıklayın: kesim frekansında 3.54 V ∠ −45°.', doc: ex('RC alçak geçiren') },
];
