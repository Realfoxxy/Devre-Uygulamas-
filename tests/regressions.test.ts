// Denetimde bulunan hatalar için regresyon testleri (elle hesaplanan değerler).
import { describe, expect, it } from 'vitest';
import { AnalysisSettings, DEFAULT_ANALYSIS } from '../src/core/circuit';
import { instPower } from '../src/core/energy';
import { buildNetlist, netlistText } from '../src/core/netlist';
import type { ACResult, DCResult, TranResult } from '../src/core/results';
import { analyze } from '../src/solver/analyze';
import { toLatex } from '../src/solver/methods/export';
import { nodeEquations } from '../src/solver/methods/nodal';
import { secondOrderAnalysis } from '../src/solver/methods/secondOrder';
import { sourceTransform, superposition, thevenin } from '../src/solver/methods/theorems';
import { parseNetlistText } from '../src/solver/textNetlist';
import { BOOK } from '../src/core/exampleBook';

const S = (o: Partial<AnalysisSettings> = {}): AnalysisSettings => ({ ...DEFAULT_ANALYSIS, ...o });

describe('Denetim regresyonları', () => {
  it('yüklü potansiyometre: güç iki parçanın toplamı, pin akımları KAY’ı sağlar', () => {
    // 10 V, 1 kΩ pot (a = 0.5), orta uçta 500 Ω yük → v_w = 10/3 V
    const nl = parseNetlistText('V1 1 0 DC 10\nPOT1 1 0 2 1k 0.5\nR1 2 0 500');
    const r = analyze(nl, S({ type: 'dc' })).result as DCResult;
    const pot = r.comps.POT1;
    const vw = 10 / 3;
    expect(pot.pinV![2]).toBeCloseTo(vw, 9);
    expect(pot.P).toBeCloseTo((10 - vw) ** 2 / 500 + vw ** 2 / 500, 9);
    expect(pot.pinI!.reduce((s, x) => s + x, 0)).toBeCloseTo(0, 12);
    expect(pot.pinI![2]).toBeCloseTo(-vw / 500, 9); // orta uçtan yüke akan akım
    const total = Object.values(r.comps).reduce((s, c) => s + c.P, 0);
    expect(total).toBeCloseTo(0, 12);
  });

  it('op-amp gücü DC, AC ve geçici rejimde aynı işaretli (güç veriyor)', () => {
    const txt = (src: string) => `V1 1 0 ${src}\nR1 1 2 1k\nR2 2 3 2k\nOA1 0 2 3 ideal\nRL 3 0 1k`;
    // v_o = −2 V, çıkış akımı −3 mA → op-amp 6 mW veriyor
    const dc = analyze(parseNetlistText(txt('DC 1')), S({ type: 'dc' })).result as DCResult;
    expect(dc.comps.OA1.P).toBeCloseTo(-6e-3, 9);
    const ac = analyze(parseNetlistText(txt('AC 1 1k 0')), S({ type: 'ac' })).result as ACResult;
    expect(ac.comps.OA1.P).toBeCloseTo(-3e-3, 9);
    const tr = analyze(parseNetlistText(txt('DC 1')), S({ type: 'transient', tStop: 1e-3 })).result as TranResult;
    expect(instPower(tr.comps.OA1, tr.t.length - 1)).toBeCloseTo(-6e-3, 9);
  });

  it('darbe kenarı bir adım erken uygulanmaz: RC, 2 ms’deki düşen kenardan sonra formülle eşleşir', () => {
    const nl = parseNetlistText('V1 1 0 DC 0\nR1 1 2 1k\nC1 2 0 1u');
    nl.elements[0].params = { mode: 'PULSE', w0: 0, w1: 5, td: 0, pw: 2e-3, per: 4e-3 };
    const r = analyze(nl, S({ type: 'transient', tStop: 4e-3, h: 20e-6 })).result as TranResult;
    const at = (t: number) => r.comps.C1.V[r.t.findIndex((x) => Math.abs(x - t) < 1e-12)];
    const x0 = 5 * (1 - Math.exp(-2));
    expect(at(2e-3)).toBeCloseTo(x0, 4);
    expect(at(2.5e-3)).toBeCloseTo(x0 * Math.exp(-0.5), 4);
    expect(at(4e-3)).toBeCloseTo(x0 * Math.exp(-2), 4);
  });

  it('varsayılan yöntem trapez: RC şarjında 5τ anındaki akım formülle %0.1 içinde', () => {
    const nl = parseNetlistText('V1 1 0 DC 10\nR1 1 2 1k\nC1 2 0 100u');
    const r = analyze(nl, S({ type: 'transient', tStop: 0.5 })).result as TranResult;
    expect(r.method).toBe('trap');
    const i = r.comps.R1.I[r.t.length - 1];
    const exact = 0.01 * Math.exp(-5);
    expect(Math.abs(i - exact) / exact).toBeLessThan(1e-3);
  });

  it('paralel kapasitörler: t = 0+ başlangıç akımları C oranında bölüşülür (tran0 tekil matris düşmez)', () => {
    const ex = BOOK.find((e) => e.name.includes('Paralel kapasitörler'))!;
    const nl = buildNetlist(ex.doc.components, ex.doc.wires);
    const r = analyze(nl, ex.doc.analysis).result as TranResult;
    // t = 0+ toplam akım 10 V / 2 kΩ = 5 mA; C1=2 µF, C2=3 µF → 2:3 oranında (2 mA ve 3 mA) bölüşülür
    expect(r.comps.R1.I[0]).toBeCloseTo(5e-3, 5);
    expect(r.comps.C1.I[0]).toBeCloseTo(2e-3, 5);
    expect(r.comps.C2.I[0]).toBeCloseTo(3e-3, 5);
  });

  it('seri kapasitörler ve paralel indüktörler: durum uzayı indirgemesi tekil olmayan 1. derece sistem üretir', () => {
    const nlC = parseNetlistText('V1 1 0 DC 10\nR1 1 2 1k\nC1 2 3 2u\nC2 3 0 2u');
    const soC = secondOrderAnalysis(nlC);
    expect(soC.ok).toBe(true);
    expect(soC.order).toBe(1);
    expect(soC.A?.[0]?.[0]).toBeCloseTo(-1 / (1e3 * 1e-6), 6);

    const nlL = parseNetlistText('V1 1 0 DC 10\nR1 1 2 100\nL1 2 0 20m\nL2 2 0 20m');
    const soL = secondOrderAnalysis(nlL);
    expect(soL.ok).toBe(true);
    expect(soL.order).toBe(1);
    expect(soL.A?.[0]?.[0]).toBeCloseTo(-100 / 10e-3, 6);
  });

  it('op-amp sapma (offset) modeli: AC analizde DC sapma basılmaz, DC analizde giriş akımları KAY sağlar ve süperpozisyona katılır', () => {
    const nlOff = parseNetlistText('V1 1 0 AC 1 1k 0\nR1 2 0 1k\nR2 2 3 9k\nOA1 1 2 3 offset\nRL 3 0 1k');
    const acOff = analyze(nlOff, S({ type: 'ac', freq: 1000 })).result as ACResult;
    expect(acOff.comps.RL.V.re).toBeCloseTo(10, 9);
    expect(acOff.comps.RL.V.im).toBeCloseTo(0, 9);

    const nlDc = parseNetlistText('V1 1 0 DC 1\nR1 1 2 1k\nR2 2 3 2k\nOA1 0 2 3 ideal\nRL 3 0 1k');
    nlDc.elements.find((e) => e.id === 'OA1')!.params = { model: 'offset', gainA: 1e5, rin: 2e6, rout: 75, vos: 2e-3, ib: 50e-9 };
    const dc = analyze(nlDc, S({ type: 'dc' })).result as DCResult;
    // Düğüm 2'de KAY (düğüm 2'den çıkan akımlar toplamı): -I(R1) + I(R2) + I_OA1(-) = 0
    expect(-dc.comps.R1.I + dc.comps.R2.I + dc.comps.OA1.pinI![1]).toBeCloseTo(0, 12);

    const sup = superposition(nlDc, 'RL', { kind: 'dc' });
    expect('error' in sup).toBe(false);
    if (!('error' in sup)) {
      expect(sup.sumV.re).toBeCloseTo(sup.full.V.re, 9);
      expect(sup.sumI.re).toBeCloseTo(sup.full.I.re, 9);
    }
  });

  it('sıcaklık sensörü (TS): Thevenin ve süperpozisyonda bağımsız DC kaynak olarak işlenir', () => {
    const nl = parseNetlistText('V1 1 0 DC 5\nR1 1 2 1k\nR2 2 0 1k');
    nl.elements.push({ id: 'TS1', type: 'TS', nodes: [2, 0], params: { tempC: 25, kT: 1e-6 } });
    const sup = superposition(nl, 'R2', { kind: 'dc' });
    expect('error' in sup).toBe(false);
    if (!('error' in sup)) {
      expect(sup.rows.map((r) => r.source)).toEqual(['V1', 'TS1']);
      expect(sup.sumV.re).toBeCloseTo(sup.full.V.re, 9);
    }
    const th = thevenin(nl, 2, 0, { kind: 'dc' });
    expect(th.Zth?.re).toBeCloseTo(500, 9);
  });

  it('2. derece tam yanıt: faz açılı (phase ≠ 0) sinüzoidal kaynakta sembolik çözüm sayısal çözümle uyuşur', () => {
    const nl = parseNetlistText('V1 1 0 AC 10 100 45\nR1 1 2 100\nL1 2 3 50m\nC1 3 0 10u');
    const tr = analyze(nl, S({ type: 'transient', tStop: 20e-3, h: 20e-6 })).result as TranResult;
    const resp = tr.secondOrder?.response;
    expect(resp).toBeDefined();
    expect(resp!.deviation).toBeDefined();
    expect(resp!.deviation!).toBeLessThan(0.5);
  });

  it('düğüm denklemleri (KDY): t < 0 anahtar geçişlerini dikkate alır ve LaTeX çıktısı alt simgeleri bozmaz', () => {
    const nl = parseNetlistText('I1 0 1 DC 1\nR1 1 0 10\nR2 2 0 20');
    nl.elements.push({ id: 'SW1', type: 'SW', nodes: [1, 2], params: { sw0: 'open', times: [-1e-3] } });
    const ne = nodeEquations(nl);
    expect(ne.ok).toBe(true);
    // t = 0 anında SW1 kapalı olduğundan v1 = v2 = 1 / (1/10 + 1/20) = 20/3 V olur
    expect(ne.values.v1).toBeCloseTo(20 / 3, 9);
    expect(ne.values.v2).toBeCloseTo(20 / 3, 9);
    const latex = toLatex(ne.equations, ne.A, ne.b, ne.unknowns, 'G');
    expect(latex).toContain('v_{1}');
    expect(latex).not.toContain('v_{_{1}}');
  });

  it('kaynak dönüşümü: STEP kaynağında w0 değerini kullanır ve bağımlı kaynak kontrol elemanını reddeder', () => {
    const nl = parseNetlistText('V1 1 0 DC 0\nR1 1 2 10\nR2 2 0 10');
    nl.elements[0].params = { mode: 'STEP', w0: 5, w1: 12, td: 1e-3 };
    const res = sourceTransform(nl, 'V1', { resistor: 'R1' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.kind).toBe('VtoI');
      expect(res.value).toBeCloseTo(0.5, 9);
    }

    const nlDep = parseNetlistText('V1 1 0 DC 10\nR1 1 2 10\nR2 2 0 20\nE1 3 0 1 2 2\nR3 3 0 10');
    nlDep.elements.find((e) => e.id === 'E1')!.params.ctrl = { ref: 'R1', kind: 'V' };
    const rej = sourceTransform(nlDep, 'V1', { resistor: 'R1' });
    expect(rej.ok).toBe(false);
  });

  it('netlistText tüm bileşen tiplerini yazar ve SW2/POT iki uçlu bağlantıya izin verir', () => {
    const nl = parseNetlistText('V1 1 0 DC 10\nPOT1 1 2 2 1k 0.5\nSW21 2 0 3 a 1m\nOA1 1 2 4 ideal\nR1 4 0 1k');
    const txt = netlistText(nl);
    expect(txt).toContain('POT1   1  2  2  1.00 kΩ, a = 0.50');
    expect(txt).toContain('SW21   2  0  3  A ⇄ 1.00ms');
    expect(txt).toContain('OA1    1  2  4  ideal');
  });
});

describe('Birleşik durum değişkenleri (seri C, paralel L)', () => {
  const run = (txt: string, tStop: number) => {
    const nl = parseNetlistText(txt);
    const r = analyze(nl, { ...DEFAULT_ANALYSIS, type: 'transient', tStop }).result as TranResult;
    return { nl, r, a: r.secondOrder!.analysis };
  };

  it('seri iki C: derece 2, durum toplam gerilim, formül simülasyonla eşleşir (ters bağlı C dahil)', async () => {
    const { completeResponse } = await import('../src/solver/methods/secondOrder');
    for (const c2 of ['C2 4 0 2u', 'C2 0 4 2u']) {
      const { nl, r, a } = run(`V1 1 0 DC 10\nR1 1 2 100\nL1 2 3 10m\nC1 3 4 2u\n${c2}`, 4e-3);
      expect(a.order).toBe(2);
      expect(a.omega0).toBeCloseTo(10000, 6); // C_eş = 1 µF
      expect(a.states[0].terms?.map((t) => t.id)).toEqual(['C1', 'C2']);
      for (let i = 0; i < 2; i++) expect(completeResponse(nl, a, r, i)!.deviation!).toBeLessThan(0.05);
      // son değer: toplam gerilim 10 V
      const last = r.t.length - 1;
      const sign = a.states[0].terms![1].sign;
      expect(r.comps.C1.V[last] + sign * r.comps.C2.V[last]).toBeCloseTo(10, 1);
    }
  });

  it('paralel iki L: derece 2, durum toplam akım (ters bağlı L dahil)', async () => {
    const { completeResponse } = await import('../src/solver/methods/secondOrder');
    for (const l2 of ['L2 1 0 2', 'L2 0 1 2']) {
      const { nl, r, a } = run(`I1 0 1 DC 1\nR1 1 0 0.6667\nL1 1 0 2\n${l2}\nC1 1 0 0.5`, 8);
      expect(a.order).toBe(2);
      const k = a.states.findIndex((s) => s.kind === 'L');
      expect(a.states[k].value).toBeCloseTo(1, 9);
      expect(completeResponse(nl, a, r, k)!.deviation!).toBeLessThan(0.05);
    }
  });
});

describe('İkinci denetim (ngspice, rastgele devreler, dosya taraması)', () => {
  it('zaman sabitleri çok farklıysa geçici analiz çökmez, adım sayısı sınırda kalır', async () => {
    const { MAX_STEPS } = await import('../src/solver/transient');
    // τ1 = 1 ps, τ2 = 1 s
    const nl = parseNetlistText('V1 1 0 DC 1\nR1 1 2 1\nC1 2 0 1p\nR2 1 3 1Meg\nC2 3 0 1u');
    const out = analyze(nl, { ...DEFAULT_ANALYSIS, type: 'transient' });
    expect(out.ok).toBe(true);
    expect((out.result as TranResult).t.length).toBeLessThanOrEqual(MAX_STEPS + 10);
  });

  it('gerilim kaynağına doğrudan paralel kapasitör: trapez sahte salınım üretmez, kullanıcıya not düşülür', () => {
    const nl = parseNetlistText('V1 1 0 DC 12\nC1 1 0 1u\nR1 1 0 1k');
    const out = analyze(nl, { ...DEFAULT_ANALYSIS, type: 'transient', method: 'trap' });
    const r = out.result as TranResult;
    for (let k = 2; k < r.t.length; k++) expect(Math.abs(r.comps.C1.I[k])).toBeLessThan(1e-9);
    expect(r.comps.C1.V[r.t.length - 1]).toBeCloseTo(12, 9);
    expect(out.info.some((s) => /C1: elle girilen başlangıç gerilimi/.test(s))).toBe(true);
  });

  it('pozitif kökü olan (kararsız) yüksek dereceli devre uyarı verir ve simülasyon durur', () => {
    const nl = parseNetlistText(
      'R1 1 0 5700\nR2 2 1 45500\nR3 3 2 1130\nR4 4 2 2170\nR5 5 3 330\nV1 2 0 DC 5.36\nR6 2 3 1300\nL1 2 3 3.74e-7\nE1 5 0 0.17 R4\nL2 1 2 0.000166\nR7 3 5 92.4\nF1 2 1 1.17 L2\nL3 1 0 0.00946',
    );
    const out = analyze(nl, { ...DEFAULT_ANALYSIS, type: 'transient' });
    expect(out.issues.some((i) => /kararsız/.test(i.message))).toBe(true);
    expect(out.info.some((s) => /durduruldu/.test(s))).toBe(true);
  });

  it('dosyada prototip adlı bileşen türü ("constructor", "__proto__" …) kabul edilmez', async () => {
    const { deserialize } = await import('../src/storage/project');
    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const doc = deserialize(JSON.stringify({ version: 2, components: [{ id: 'X1', type, x: 0, y: 0, rot: 0, params: {} }, { id: 'R1', type: 'R', x: 4, y: 0, rot: 0, params: { value: 5 } }], wires: [] }));
      expect(doc.components.map((c) => c.id)).toEqual(['R1']);
    }
  });

  it('SPICE dışa aktarma: op-amp, potansiyometre, sensör, iki yollu anahtar, üstel kaynak ve bobin akımı kontrolü yazılır', async () => {
    const { toSpice } = await import('../src/solver/methods/export');
    const nl = parseNetlistText('V1 1 0 DC 1\nR1 1 2 1k\nR2 2 3 10k\nOA1 0 2 3 ideal\nPOT1 3 0 4 10k 0.3\nTS1 0 5 1u 25\nR3 5 0 1k\nL1 4 0 1m\nH1 6 0 50 L1\nR4 6 0 1k\nSW1 4 7 0 B 1m\nR5 7 0 1k');
    nl.elements[0].params = { mode: 'EXP', wk: 5, wb: 1000, td: 0 };
    const cir = toSpice(nl, 't', { analysis: { ...DEFAULT_ANALYSIS, type: 'transient', tStop: 5e-3, h: 1e-6 } });
    expect(cir).toMatch(/^EOA1 3 0 0 2 1e\+?9/m);
    expect(cir).toMatch(/^RPOT1A 3 4 7000/m);
    expect(cir).toMatch(/^RPOT1B 4 0 3000/m);
    expect(cir).toMatch(/^ITS1 0 5 DC 0\.00029815/m);
    expect(cir).toMatch(/^VS_L1 L1_s 0 DC 0/m);
    expect(cir).toMatch(/^H1 6 0 VS_L1 50/m);
    // ortak uç 4, A ucu 7, B ucu 0; t < 0'da B konumunda, 1 ms'de A'ya geçer
    expect(cir).toMatch(/^VSW1_c VSW1_c_n 0 PWL\(0 0 0\.001 0 0\.001000001 1\)/m);
    expect(cir).toMatch(/^SW1A 4 7 VSW1_c_n 0 SWDL/m);
    expect(cir).toMatch(/^SW1B 4 0 0 VSW1_c_n SWDLN/m);
    expect(cir).toMatch(/^V1 1 0 DC 0 PWL\(/m);
    // anahtarlı devrede başlangıç koşulu otomatiktir: IC ve uic yazılmaz
    expect(cir).toMatch(/^L1 4 L1_s 0\.001$/m);
    expect(cir).toMatch(/^\.tran 0\.000001 0\.005 0 0\.000001$/m);
    // anahtarsız devrede elle başlangıç koşulu (varsayılan 0) IC= ve uic ile yazılır
    const rc = toSpice(parseNetlistText('V1 1 0 DC 10\nR1 1 2 1k\nC1 2 0 100u'), 't', { analysis: { ...DEFAULT_ANALYSIS, type: 'transient', tStop: 0.5, h: 1e-3 } });
    expect(rc).toMatch(/^C1 2 0 0\.0001 IC=0$/m);
    expect(rc).toMatch(/ uic$/m);
  });
});
