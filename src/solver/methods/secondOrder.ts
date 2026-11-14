// İkinci (ve daha yüksek) derece devreler (Bölüm 9): durum değişkenleri yöntemi (9.9),
// karakteristik denklem, doğal yanıt türü, zorlanmış ve tam yanıt. Sonuç düz veridir (Worker'dan aktarılır).
import { Complex, abs, cx } from '../../core/complex';
import type { Netlist, NetElement } from '../../core/netlist';
import type { TranResult } from '../../core/results';
import { formatEng } from '../../core/units';
import { SingularMatrixError, solveComplex, solveReal } from '../lu';
import { makeCtx, measureElement, newSystem, solutionFrom, stampAll } from '../stamp';
import { num } from './linear';

export interface StateVar {
  id: string;
  kind: 'C' | 'L';
  name: string;
  /** Paralel C / seri L birleşmesiyle eşdeğer değer */
  value: number;
  merged: string[];
  /** Seri C / paralel L birleşmesinde durum değişkeni elemanların toplamıdır: Σ sign·(v ya da i) */
  terms?: { id: string; sign: number }[];
}

/** Durum değişkeninin simülasyondaki değeri (birleşik durumlarda elemanların işaretli toplamı) */
export function stateSim(res: TranResult, s: StateVar, k: number): number {
  const at = (id: string) => (s.kind === 'C' ? res.comps[id].V[k] : res.comps[id].I[k]);
  return s.terms ? s.terms.reduce((a, t) => a + t.sign * at(t.id), 0) : at(s.id);
}

const addTerm = (s: StateVar, id: string, sign: number) => {
  s.terms ??= [{ id: s.id, sign: 1 }];
  s.terms.push({ id, sign });
  const x = s.kind === 'C' ? 'v' : 'i';
  s.name = `(${s.terms.map((t, i) => `${i ? (t.sign > 0 ? ' + ' : ' − ') : ''}${x}_${t.id}`).join('')})`;
};

export type Damping = 'over' | 'critical' | 'under' | 'undamped' | 'first' | 'higher' | 'unstable';

export interface SecondOrderResult {
  ok: boolean;
  message?: string;
  order: number;
  states: StateVar[];
  /** Bağımsız olmayan elemanlar ve nedenleri */
  dependent: { id: string; reason: string }[];
  inputs: string[];
  A: number[][];
  B: number[][];
  /** Öğrencinin yazacağı biçimde durum denklemleri */
  stateEquations: string[];
  /** det(sI − A) katsayıları, en yüksek dereceden: [1, a_{n−1}, …, a0] */
  poly: number[];
  polyText: string;
  roots: Complex[];
  alpha?: number;
  omega0?: number;
  omegaD?: number;
  Td?: number;
  damping: Damping;
  dampingText: string;
  /** Seri / paralel RLC ise kitabın formülü */
  rlcText?: string;
  /** Seçilen çıkış için diferansiyel denklem (2. derece) */
  odeText?: string;
}

const STATE_SRC = new Set(['V', 'I']);

/** Durum değişkenleri, bağımsız olmayan C (C–V döngüsü) ve L (L–I kesitlemesi) elemanları */
export function findStates(nl: Netlist): { states: StateVar[]; dependent: { id: string; reason: string }[]; mergedTo: Map<string, string> } {
  const dependent: { id: string; reason: string }[] = [];
  const mergedTo = new Map<string, string>();
  const states: StateVar[] = [];
  const n = nl.nodeCount;
  // C–V döngüleri: önce gerilim kaynakları, sonra kapasitörler; döngüyü kapatan C bağımsız değildir
  const parent = Array.from({ length: n + 1 }, (_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const volt = nl.elements.filter((e) => e.type === 'V' || e.type === 'E' || e.type === 'H' || (e.type === 'AM' && !e.params.real));
  const loopSrc = new Map<number, string>();
  for (const v of volt) {
    const ra = find(v.nodes[0]);
    const rb = find(v.nodes[1]);
    if (ra !== rb) parent[ra] = rb;
    loopSrc.set(find(v.nodes[0]), v.id);
  }
  for (const op of nl.elements.filter((e) => e.type === 'OA')) {
    const ra = find(op.nodes[2]);
    const rb = find(0);
    if (ra !== rb) parent[ra] = rb;
  }
  const pairKey = (e: NetElement) => [...e.nodes].sort((x, y) => x - y).join('-');
  const activeEls = nl.elements.filter((e) => !(e.type === 'VM' && !e.params.real));
  const Cs = nl.elements.filter((e) => e.type === 'C');
  for (const c of Cs) {
    const ra = find(c.nodes[0]);
    const rb = find(c.nodes[1]);
    if (ra === rb) {
      const twin = states.find((s) => s.kind === 'C' && pairKey(nl.elements.find((e) => e.id === s.id)!) === pairKey(c));
      if (twin) {
        twin.value += Number(c.params.value);
        twin.merged.push(c.id);
        mergedTo.set(c.id, twin.id);
        dependent.push({ id: c.id, reason: `${c.id}, ${twin.id} ile paralel: ikisi tek durum değişkeni sayılır (C_eş = ${formatEng(twin.value, 'F')}).` });
      } else {
        const srcs = volt.filter((v) => find(v.nodes[0]) === ra).map((v) => v.id);
        dependent.push({ id: c.id, reason: `${c.id}'in gerilimi ${srcs.join(', ') || 'diğer kapasitörler'} tarafından belirleniyor; bağımsız durum değişkeni değil (C–V döngüsü).` });
      }
      continue;
    }
    // seri kapasitör: bir ara düğümü yalnızca iki kapasitör paylaşıyorsa eşdeğer C'ye indirgenir
    const midOf = (s: StateVar) => {
      const o = Cs.find((x) => x.id === s.id)!;
      return c.nodes.find((k) => o.nodes.includes(k) && activeEls.filter((e) => e.nodes.includes(k)).length === 2);
    };
    const seriesPartner = states.find((s) => s.kind === 'C' && midOf(s) !== undefined);
    if (seriesPartner) {
      const cVal = Number(c.params.value);
      // durum = ortak eleman yönünde toplam gerilim; ortak düğüm iki elemanda aynı uçtaysa gerilimler ters yönlü
      const mid = midOf(seriesPartner)!;
      const po = Cs.find((x) => x.id === seriesPartner.id)!;
      addTerm(seriesPartner, c.id, po.nodes.indexOf(mid) === c.nodes.indexOf(mid) ? -1 : 1);
      seriesPartner.value = (seriesPartner.value * cVal) / (seriesPartner.value + cVal);
      seriesPartner.merged.push(c.id);
      mergedTo.set(c.id, seriesPartner.id);
      dependent.push({ id: c.id, reason: `${c.id}, ${seriesPartner.id} ile seri: ikisi tek durum değişkeni sayılır (C_eş = ${formatEng(seriesPartner.value, 'F')}).` });
      parent[ra] = rb;
      continue;
    }
    parent[ra] = rb;
    states.push({ id: c.id, kind: 'C', name: `v_${c.id}`, value: Number(c.params.value), merged: [] });
  }
  // L–I kesitlemeleri: L ve akım kaynakları dışındaki elemanlar düğümleri birleştirir; kalan grafikte
  // her düğüm için KAY bir kısıttır. Kısıtların bağımsız sayısı kadar L bağımsız değildir.
  const p2 = Array.from({ length: n + 1 }, (_, i) => i);
  const f2 = (a: number): number => (p2[a] === a ? a : (p2[a] = f2(p2[a])));
  const currentLike = new Set(['L', 'I', 'G', 'F', 'TS']);
  for (const e of nl.elements) {
    if (currentLike.has(e.type) || (e.type === 'VM' && !e.params.real)) continue;
    if (e.type === 'SW' || e.type === 'SW2' || e.type === 'POT' || e.type === 'OA') {
      // anahtar / üç uçlu elemanlar dirençli bağlantı sayılır
      for (let i = 1; i < e.nodes.length; i++) p2[f2(e.nodes[i])] = f2(e.nodes[0]);
      continue;
    }
    p2[f2(e.nodes[0])] = f2(e.nodes[1]);
  }
  const Ls = nl.elements.filter((e) => e.type === 'L');
  const vertices = [...new Set(Array.from({ length: n + 1 }, (_, i) => f2(i)))];
  // indis matrisi (köşe × L), Gauss eliminasyonu: pivot sütunları bağımlı L
  const M = vertices.map((v) => Ls.map((l) => (f2(l.nodes[0]) === v ? 1 : 0) - (f2(l.nodes[1]) === v ? 1 : 0)));
  const depL = new Set<number>();
  let row = 0;
  for (let col = Ls.length - 1; col >= 0 && row < M.length; col--) {
    let piv = -1;
    for (let r = row; r < M.length; r++) if (Math.abs(M[r][col]) > 1e-12) piv = r;
    if (piv < 0) continue;
    [M[row], M[piv]] = [M[piv], M[row]];
    for (let r = 0; r < M.length; r++) {
      if (r === row || Math.abs(M[r][col]) < 1e-12) continue;
      const f = M[r][col] / M[row][col];
      for (let c = 0; c < Ls.length; c++) M[r][c] -= f * M[row][c];
    }
    depL.add(col);
    row++;
  }
  Ls.forEach((l, i) => {
    if (!depL.has(i)) {
      const twin = states.find((s) => s.kind === 'L' && pairKey(Ls.find((x) => x.id === s.id)!) === pairKey(l));
      if (twin) {
        const lVal = Number(l.params.value);
        twin.value = (twin.value * lVal) / (twin.value + lVal);
        twin.merged.push(l.id);
        addTerm(twin, l.id, Ls.find((x) => x.id === twin.id)!.nodes[0] === l.nodes[0] ? 1 : -1);
        mergedTo.set(l.id, twin.id);
        dependent.push({ id: l.id, reason: `${l.id}, ${twin.id} ile paralel: ikisi tek durum değişkeni sayılır (L_eş = ${formatEng(twin.value, 'H')}).` });
        return;
      }
      states.push({ id: l.id, kind: 'L', name: `i_${l.id}`, value: Number(l.params.value), merged: [] });
      return;
    }
  });
  Ls.forEach((l, i) => {
    if (!depL.has(i)) return;
    // seri bobin: bir ara düğümü yalnızca iki bobin paylaşıyorsa eşdeğer L'ye eklenir
    const partner = states.find((s) => {
      if (s.kind !== 'L') return false;
      const o = Ls.find((x) => x.id === s.id)!;
      const shared = l.nodes.filter((k) => o.nodes.includes(k));
      return shared.some((k) => activeEls.filter((e) => e.nodes.includes(k)).length === 2);
    });
    if (partner) {
      partner.value += Number(l.params.value);
      partner.merged.push(l.id);
      mergedTo.set(l.id, partner.id);
      dependent.push({ id: l.id, reason: `${l.id}, ${partner.id} ile seri: ikisi tek durum değişkeni sayılır (L_eş = ${formatEng(partner.value, 'H')}).` });
    } else
      dependent.push({ id: l.id, reason: `${l.id}'in akımı bobinler ve akım kaynaklarından oluşan bir kesitlemede belirleniyor; bağımsız durum değişkeni değil (L–I kesitlemesi).` });
  });
  // sıralama: önce C, sonra L (kitaptaki gibi)
  states.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'C' ? -1 : 1));
  return { states, dependent, mergedTo };
}

/** Durum matrisleri: her durum değişkeni sırayla 1 yapılıp dirençli devre çözülür. */
function stateMatrices(nl: Netlist, states: StateVar[], dependent: { id: string; reason?: string }[]) {
  const depMap = new Map(dependent.map((d) => [d.id, d.reason ?? '']));
  const stateIds = new Set(states.map((s) => s.id));
  const inputs = nl.elements.filter((e) => STATE_SRC.has(e.type)).map((e) => e.id);
  // Dirençli eşdeğer: C → gerilim kaynağı, L → akım kaynağı; seri birleşenler kısa (AM), paralel birleşenler açık
  const elements: NetElement[] = [];
  for (const e of nl.elements) {
    if (stateIds.has(e.id)) {
      elements.push({ ...e, type: e.type === 'C' ? 'V' : 'I', params: { mode: 'DC', value: 0 } });
    } else if (depMap.has(e.id)) {
      const r = depMap.get(e.id)!;
      if ((e.type === 'L' && !r.includes('paralel')) || (e.type === 'C' && r.includes(' ile seri:'))) {
        elements.push({ id: e.id, type: 'AM', nodes: e.nodes, params: {} });
      }
    } else elements.push(e);
  }
  const rn: Netlist = { ...nl, elements };
  const derivatives = (over: Map<string, Complex>): number[] => {
    const ctx = makeCtx('dc', rn, { zero: true, sourceOverride: over, swTime: 0 });
    const sys = newSystem(rn, ctx, false);
    stampAll(sys, rn, ctx);
    const x = sys.solveReal();
    const sol = solutionFrom(sys, { re: x });
    return states.map((s) => {
      const m = measureElement(rn.elements.find((e) => e.id === s.id)!, ctx, sol);
      // C: dv/dt = i_C / C ; L: di/dt = v_L / L
      return s.kind === 'C' ? m.I.re / s.value : m.V.re / s.value;
    });
  };
  const n = states.length;
  const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const B: number[][] = Array.from({ length: n }, () => new Array(inputs.length).fill(0));
  const zeroAll = () => new Map<string, Complex>(states.map((s) => [s.id, cx(0)]));
  for (let j = 0; j < n; j++) {
    const o = zeroAll();
    o.set(states[j].id, cx(1));
    const d = derivatives(o);
    for (let i = 0; i < n; i++) A[i][j] = d[i];
  }
  inputs.forEach((u, k) => {
    const o = zeroAll();
    o.set(u, cx(1));
    const d = derivatives(o);
    for (let i = 0; i < n; i++) B[i][k] = d[i];
  });
  return { A, B, inputs };
}

/** det(sI − A) katsayıları (Faddeev–LeVerrier) */
export function charPoly(A: number[][]): number[] {
  const n = A.length;
  const coeffs = [1];
  let M = A.map((r) => r.map(() => 0));
  const I = A.map((r, i) => r.map((_, j) => (i === j ? 1 : 0)));
  for (let k = 1; k <= n; k++) {
    // M_k = A·M_{k−1} + c_{k−1}·I
    const AM = A.map((r) => r.map((_, j) => r.reduce((s, a, l) => s + a * M[l][j], 0)));
    M = AM.map((r, i) => r.map((v, j) => v + coeffs[k - 1] * I[i][j]));
    const AMk = A.map((r) => r.map((_, j) => r.reduce((s, a, l) => s + a * M[l][j], 0)));
    const tr = AMk.reduce((s, r, i) => s + r[i], 0);
    coeffs.push(-tr / k);
  }
  return coeffs;
}

/** Polinom kökleri (Durand–Kerner) */
export function polyRoots(p: number[]): Complex[] {
  const n = p.length - 1;
  if (n < 1) return [];
  if (n === 1) return [cx(-p[1] / p[0])];
  const a = p.map((c) => c / p[0]);
  let z: Complex[] = Array.from({ length: n }, (_, k) => {
    const r = 1 + Math.max(...a.slice(1).map(Math.abs));
    const th = (2 * Math.PI * k) / n + 0.4;
    return cx(r * Math.cos(th), r * Math.sin(th));
  });
  const evalp = (x: Complex) => {
    let re = 1;
    let im = 0;
    for (let i = 1; i <= n; i++) {
      const nr = re * x.re - im * x.im + a[i];
      const ni = re * x.im + im * x.re;
      re = nr;
      im = ni;
    }
    return cx(re, im);
  };
  for (let it = 0; it < 500; it++) {
    let delta = 0;
    z = z.map((zi, i) => {
      let den = cx(1, 0);
      z.forEach((zj, j) => {
        if (i === j) return;
        const d = cx(zi.re - zj.re, zi.im - zj.im);
        den = cx(den.re * d.re - den.im * d.im, den.re * d.im + den.im * d.re);
      });
      const f = evalp(zi);
      const dd = den.re * den.re + den.im * den.im || 1e-300;
      const q = cx((f.re * den.re + f.im * den.im) / dd, (f.im * den.re - f.re * den.im) / dd);
      delta = Math.max(delta, abs(q));
      return cx(zi.re - q.re, zi.im - q.im);
    });
    if (delta < 1e-14 * (1 + Math.max(...z.map(abs)))) break;
  }
  return z
    .map((r) => (Math.abs(r.im) < 1e-9 * Math.max(1, Math.abs(r.re)) ? cx(r.re, 0) : r))
    .sort((x, y) => y.re - x.re || y.im - x.im);
}

const polyString = (p: number[]) => {
  const n = p.length - 1;
  const parts: string[] = [];
  p.forEach((c, i) => {
    const pow = n - i;
    if (Math.abs(c) < 1e-12 * Math.max(...p.map(Math.abs))) return;
    const mag = Math.abs(c);
    const coef = pow > 0 && Math.abs(mag - 1) < 1e-12 ? '' : num(mag);
    const v = pow === 0 ? '' : pow === 1 ? 's' : `s${pow === 2 ? '²' : pow === 3 ? '³' : `^${pow}`}`;
    const term = `${coef}${coef && v ? '·' : ''}${v}` || '0';
    parts.push(parts.length ? `${c < 0 ? '−' : '+'} ${term}` : c < 0 ? `−${term}` : term);
  });
  return `${parts.join(' ')} = 0`;
};

export function secondOrderAnalysis(nl: Netlist, outIndex = 0): SecondOrderResult {
  const empty = (message: string, extra: Partial<SecondOrderResult> = {}): SecondOrderResult => ({
    ok: false,
    message,
    order: 0,
    states: [],
    dependent: [],
    inputs: [],
    A: [],
    B: [],
    stateEquations: [],
    poly: [],
    polyText: '',
    roots: [],
    damping: 'first',
    dampingText: '',
    ...extra,
  });
  const { states, dependent } = findStates(nl);
  if (!states.length) return empty('Devrede enerji depolayan bağımsız eleman yok.', { dependent });
  let mats;
  try {
    mats = stateMatrices(nl, states, dependent);
  } catch (e) {
    if (e instanceof SingularMatrixError) return empty('Durum denklemleri kurulamadı (dirençli eşdeğer devre tekil).', { dependent, states, order: states.length });
    throw e;
  }
  const { A, B, inputs } = mats;
  const order = states.length;
  const stateEquations = states.map((s, i) => {
    const terms: string[] = [];
    const add = (c: number, v: string) => {
      const k = c * s.value; // C·dv/dt ya da L·di/dt biçimi
      if (Math.abs(k) < 1e-14) return;
      const mag = Math.abs(k);
      const t = Math.abs(mag - 1) < 1e-12 ? v : `${num(mag)}·${v}`;
      terms.push(terms.length ? `${k < 0 ? '−' : '+'} ${t}` : k < 0 ? `−${t}` : t);
    };
    states.forEach((sj, j) => add(A[i][j], sj.name));
    inputs.forEach((u, k) => add(B[i][k], u));
    const lhs = s.kind === 'C' ? `${s.merged.length ? 'C_eş' : s.id}·d${s.name}/dt` : `${s.merged.length ? 'L_eş' : s.id}·d${s.name}/dt`;
    return `${lhs} = ${terms.join(' ') || '0'}`;
  });
  const poly = charPoly(A);
  const roots = polyRoots(poly);
  const res: SecondOrderResult = {
    ok: true,
    order,
    states,
    dependent,
    inputs,
    A,
    B,
    stateEquations,
    poly,
    polyText: polyString(poly),
    roots,
    damping: 'higher',
    dampingText: '',
  };
  if (roots.some((r) => r.re > 1e-9)) {
    res.damping = 'unstable';
    res.dampingText = 'Kararsız: sağ yarı düzlemde kök var; doğal yanıt zamanla büyüyor (Bölüm 8.5).';
  }
  if (order === 1) {
    res.damping = res.damping === 'unstable' ? 'unstable' : 'first';
    const lam = roots[0].re;
    res.dampingText = res.damping === 'unstable' ? res.dampingText : `Birinci derece: s = ${num(lam)} 1/s, τ = −1/s = ${formatEng(-1 / lam, 's')}`;
  } else if (order === 2) {
    const alpha = poly[1] / 2;
    const w0sq = poly[2];
    res.alpha = alpha;
    res.omega0 = Math.sqrt(Math.max(0, w0sq));
    const w0 = res.omega0;
    if (res.damping !== 'unstable') {
      if (Math.abs(alpha) < 1e-12 * Math.max(1, w0)) {
        res.damping = 'undamped';
        res.omegaD = w0;
        res.dampingText = `Sönümsüz (α = 0): kökler ±jω₀ = ±j${num(w0)}; x_n = B₁cos ω₀t + B₂sin ω₀t`;
      } else if (Math.abs(alpha - w0) <= 0.01 * w0) {
        res.damping = 'critical';
        res.dampingText = `Kritik sönümlü (α = ω₀ ± %1): s₁ = s₂ = −α = ${num(-alpha)}; x_n = (A₁ + A₂t)e^(−αt)`;
      } else if (alpha > w0) {
        res.damping = 'over';
        const d = Math.sqrt(alpha * alpha - w0sq);
        res.dampingText = `Aşırı sönümlü (α > ω₀): s₁,₂ = −α ± √(α² − ω₀²) = ${num(-alpha + d)}, ${num(-alpha - d)}; x_n = A₁e^(s₁t) + A₂e^(s₂t)`;
      } else {
        res.damping = 'under';
        res.omegaD = Math.sqrt(w0sq - alpha * alpha);
        res.Td = (2 * Math.PI) / res.omegaD;
        res.dampingText = `Az sönümlü (α < ω₀): s₁,₂ = −α ± jω_d = ${num(-alpha)} ± j${num(res.omegaD)}; ω_d = √(ω₀² − α²) = ${num(res.omegaD)} rad/s, T_d = 2π/ω_d = ${formatEng(res.Td, 's')}; x_n = e^(−αt)(B₁cos ω_d t + B₂sin ω_d t)`;
      }
    }
    res.rlcText = rlcFormula(nl);
    // çıkış için diferansiyel denklem: x'' + 2αx' + ω₀²x = Σ (b1 u' + b0 u)
    const i = Math.min(outIndex, 1);
    const j = 1 - i;
    const rhs: string[] = [];
    inputs.forEach((u, k) => {
      const b1 = B[i][k];
      const b0 = -A[j][j] * B[i][k] + A[i][j] * B[j][k];
      if (Math.abs(b1) > 1e-14) rhs.push(`${num(b1)}·d${u}/dt`);
      if (Math.abs(b0) > 1e-14) rhs.push(`${num(b0)}·${u}`);
    });
    const x = states[i].name;
    res.odeText = `d²${x}/dt² ${poly[1] < 0 ? '−' : '+'} ${num(Math.abs(poly[1]))}·d${x}/dt ${poly[2] < 0 ? '−' : '+'} ${num(Math.abs(poly[2]))}·${x} = ${rhs.join(' + ').replace(/\+ −/g, '− ') || '0'}`;
  } else {
    if (res.damping !== 'unstable') res.dampingText = `${order}. derece devre: karakteristik polinom ve kökleri gösterilir; α ve ω₀ yalnızca ikinci derecede tanımlıdır.`;
  }
  return res;
}

/** Tamamen seri ya da paralel RLC ise kitabın tablosundaki formüller */
function rlcFormula(nl: Netlist): string | undefined {
  const R = nl.elements.filter((e) => e.type === 'R');
  const L = nl.elements.filter((e) => e.type === 'L');
  const C = nl.elements.filter((e) => e.type === 'C');
  if (R.length !== 1 || L.length !== 1 || C.length !== 1) return undefined;
  if (nl.elements.some((e) => !['R', 'L', 'C', 'V', 'I', 'VM', 'AM'].includes(e.type) || ((e.type === 'VM' || e.type === 'AM') && e.params.real)))
    return undefined;
  const r = Number(R[0].params.value);
  const l = Number(L[0].params.value);
  const c = Number(C[0].params.value);
  const key = (e: NetElement) => [...e.nodes].sort().join('-');
  if (key(R[0]) === key(L[0]) && key(L[0]) === key(C[0]))
    return `Paralel RLC: α = 1/(2RC) = 1/(2·${formatEng(r, 'Ω')}·${formatEng(c, 'F')}) = ${num(1 / (2 * r * c))} 1/s, ω₀ = 1/√(LC) = ${num(1 / Math.sqrt(l * c))} rad/s`;
  // seri: R, L, C tek bir çevrede (ara düğümlerin derecesi 2)
  const activeEls = nl.elements.filter((e) => e.type !== 'VM');
  const deg = (k: number) => activeEls.filter((e) => e.nodes.includes(k)).length;
  const els = [R[0], L[0], C[0]];
  const shared = (a: NetElement, b: NetElement) => a.nodes.filter((k) => b.nodes.includes(k) && deg(k) === 2).length > 0;
  const links = [shared(els[0], els[1]), shared(els[1], els[2]), shared(els[0], els[2])].filter(Boolean).length;
  if (links >= 2)
    return `Seri RLC: α = R/(2L) = ${formatEng(r, 'Ω')}/(2·${formatEng(l, 'H')}) = ${num(r / (2 * l))} 1/s, ω₀ = 1/√(LC) = ${num(1 / Math.sqrt(l * c))} rad/s`;
  return undefined;
}

/* ─────────────────────────── Zorlanmış ve tam yanıt ─────────────────────────── */

export interface ResponseModel {
  /** çıkış durumu */
  index: number;
  name: string;
  unit: string;
  damping: Damping;
  roots: Complex[];
  /** zorlanmış kısım: sabit + sinüsler + üsteller (+ t·e^(st) çakışma terimi) */
  xf0: number;
  sines: { mag: number; w: number; ph: number }[];
  exps: { X: number; s: number; td: number; t: boolean }[];
  /** doğal yanıt katsayıları (aşırı: A1, A2; kritik: A1, A2; az: B1, B2) */
  c1: number;
  c2: number;
  alpha: number;
  omegaD: number;
  formula: string;
  forcedText: string;
  note?: string;
  deviation?: number;
}

function forcedOf(m: ResponseModel, t: number): number {
  let x = m.xf0;
  for (const s of m.sines) x += s.mag * Math.sin(s.w * t + s.ph);
  for (const e of m.exps) x += (e.t ? e.X * (t - e.td) : e.X) * Math.exp(e.s * (t - e.td));
  return x;
}

export function responseEval(m: ResponseModel, t: number): number {
  const xf = forcedOf(m, t);
  const [s1, s2] = m.roots;
  if (m.damping === 'over') return xf + m.c1 * Math.exp(s1.re * t) + m.c2 * Math.exp(s2.re * t);
  if (m.damping === 'critical') return xf + (m.c1 + m.c2 * t) * Math.exp(-m.alpha * t);
  return xf + Math.exp(-m.alpha * t) * (m.c1 * Math.cos(m.omegaD * t) + m.c2 * Math.sin(m.omegaD * t));
}

/** (sI − A)⁻¹·b çözümü */
function resolvent(A: number[][], b: number[], s: Complex): Complex[] | null {
  const n = A.length;
  const re = new Float64Array(n * n);
  const im = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      re[i * n + j] = (i === j ? s.re : 0) - A[i][j];
      im[i * n + j] = i === j ? s.im : 0;
    }
  try {
    const x = solveComplex(re, im, b, new Float64Array(n), n);
    return Array.from({ length: n }, (_, i) => cx(x.re[i], x.im[i]));
  } catch {
    return null;
  }
}

/** Tam yanıt: ikinci derece, t = 0'dan sonra anahtarlama yoksa. */
export function completeResponse(nl: Netlist, so: SecondOrderResult, res: TranResult, outIndex = 0): ResponseModel | null {
  if (!so.ok || so.order !== 2 || so.damping === 'unstable' || so.damping === 'undamped') return null;
  const laterSwitch = nl.elements.some((e) => (e.type === 'SW' || e.type === 'SW2') && (e.params.times ?? []).some((t) => t > 0));
  const st = so.states[outIndex];
  const unit = st.kind === 'C' ? 'V' : 'A';
  const x0 = so.states.map((s) => stateSim(res, s, 0));
  const srcEls = so.inputs.map((id) => nl.elements.find((e) => e.id === id)!);
  const u0 = srcEls.map(waveAt0);
  const dx0 = so.A.map((r, i) => r.reduce((s, a, j) => s + a * x0[j], 0) + so.B[i].reduce((s, b, k) => s + b * u0[k], 0));
  const m: ResponseModel = {
    index: outIndex,
    name: st.name,
    unit,
    damping: so.damping,
    roots: so.roots,
    xf0: 0,
    sines: [],
    exps: [],
    c1: 0,
    c2: 0,
    alpha: so.alpha ?? 0,
    omegaD: so.omegaD ?? 0,
    formula: '',
    forcedText: '',
  };
  const forcedParts: string[] = [];
  const notes: string[] = [];
  // sabit kaynaklar: x_f = −(A⁻¹B u)_i
  const constIdx = srcEls.map((e, k) => (['DC', 'STEP', undefined].includes(e.params.mode) && Number(e.params.td ?? 0) <= 0 ? k : -1)).filter((k) => k >= 0);
  if (constIdx.length) {
    const b = so.A.map((_, i) => constIdx.reduce((s, k) => s + so.B[i][k] * valueAfter(srcEls[k]), 0));
    try {
      const flatA = new Float64Array(so.A.flat());
      const xinf = solveReal(flatA, b, 2);
      m.xf0 = -xinf[outIndex];
      if (Math.abs(m.xf0) > 1e-15) forcedParts.push(formatEng(m.xf0, unit));
    } catch {
      return null;
    }
  }
  for (let k = 0; k < srcEls.length; k++) {
    if (constIdx.includes(k)) continue;
    const e = srcEls[k];
    const p = e.params;
    const td = Number(p.td ?? 0);
    const bcol = so.B.map((r) => r[k]);
    if (p.mode === 'EXP') {
      if (td > 0) return null;
      const s = cx(-Number(p.wb ?? 0), 0);
      const K = Number(p.wk ?? 0);
      const coincide = so.roots.some((r) => Math.abs(r.re - s.re) < 1e-6 * Math.max(1, Math.abs(s.re)) && Math.abs(r.im) < 1e-9);
      if (!coincide) {
        const X = resolvent(so.A, bcol, s);
        if (!X) return null;
        const v = X[outIndex].re * K;
        m.exps.push({ X: v, s: s.re, td, t: false });
        forcedParts.push(`${formatEng(v, unit)}·e^(${num(s.re)}t)`);
      } else {
        // çakışma: x_f = B·t·e^(st), B = N(s)·K / (2s + a1)
        const i = outIndex;
        const j = 1 - i;
        const N = s.re * so.B[i][k] - so.A[j][j] * so.B[i][k] + so.A[i][j] * so.B[j][k];
        const Bc = (N * K) / (2 * s.re + so.poly[1]);
        m.exps.push({ X: Bc, s: s.re, td, t: true });
        forcedParts.push(`${formatEng(Bc, unit)}·t·e^(${num(s.re)}t)`);
        notes.push(`Giriş doğal yanıtla çakışıyor (s = ${num(s.re)} bir kök): x_f = B·t·e^(${num(s.re)}t) alındı.`);
      }
    } else if (p.mode === 'AC' || p.mode === 'SINE_U') {
      if (td > 0) return null;
      const w = 2 * Math.PI * Number(p.freq ?? 0);
      const X = resolvent(so.A, bcol, cx(0, w));
      if (!X) return null;
      const z = X[outIndex];
      const mag = abs(z) * Number(p.amp ?? 0);
      const ph = Math.atan2(z.im, z.re) + (Number(p.phase ?? 0) * Math.PI) / 180;
      m.sines.push({ mag, w, ph });
      forcedParts.push(`${formatEng(mag, unit)}·sin(${num(w)}t ${ph < 0 ? '−' : '+'} ${Math.abs((ph * 180) / Math.PI).toFixed(1)}°)`);
    } else return null;
  }
  // doğal yanıt sabitleri: x(0⁺) ve dx/dt(0⁺) ile
  const d0 = x0[outIndex] - forcedOf(m, 0);
  const hh = 1e-9 / Math.max(1, Math.max(...so.roots.map(abs)));
  const dxf = (forcedOf(m, hh) - forcedOf(m, -hh)) / (2 * hh);
  const d1 = dx0[outIndex] - dxf;
  const [s1, s2] = so.roots;
  if (m.damping === 'over') {
    m.c1 = (d1 - s2.re * d0) / (s1.re - s2.re);
    m.c2 = d0 - m.c1;
    m.formula = `${st.name}(t) = ${forcedParts.join(' + ') || '0'} ${sgn(m.c1)} ${formatEng(Math.abs(m.c1), unit)}·e^(${num(s1.re)}t) ${sgn(m.c2)} ${formatEng(Math.abs(m.c2), unit)}·e^(${num(s2.re)}t)`;
  } else if (m.damping === 'critical') {
    m.c1 = d0;
    m.c2 = d1 + m.alpha * d0;
    m.formula = `${st.name}(t) = ${forcedParts.join(' + ') || '0'} + (${formatEng(m.c1, unit)} ${sgn(m.c2)} ${num(Math.abs(m.c2))}·t)·e^(−${num(m.alpha)}t)`;
  } else {
    m.c1 = d0;
    m.c2 = (d1 + m.alpha * d0) / m.omegaD;
    m.formula = `${st.name}(t) = ${forcedParts.join(' + ') || '0'} + e^(−${num(m.alpha)}t)·(${formatEng(m.c1, unit)}·cos ${num(m.omegaD)}t ${sgn(m.c2)} ${formatEng(Math.abs(m.c2), unit)}·sin ${num(m.omegaD)}t)`;
  }
  m.forcedText = `zorlanmış: ${forcedParts.join(' + ') || '0'}`;
  if (laterSwitch) notes.push('t = 0 sonrasında da anahtarlama var; formül yalnızca ilk aralık için geçerli.');
  m.note = notes.join(' ') || undefined;
  // çözücünün kendi kontrolü (sonradan anahtarlama varsa yalnızca ilk aralıkta karşılaştırılır)
  const firstSw = Math.min(
    Infinity,
    ...nl.elements
      .filter((e) => e.type === 'SW' || e.type === 'SW2')
      .flatMap((e) => (e.params.times ?? []).filter((t) => t > 0)),
  );
  const sim = Array.from({ length: res.t.length }, (_, k) => stateSim(res, st, k));
  let dev = 0;
  let sc = 1e-15;
  for (let k = 0; k < res.t.length; k++) {
    if (res.t[k] >= firstSw - 1e-15) break;
    sc = Math.max(sc, Math.abs(sim[k]));
    dev = Math.max(dev, Math.abs(responseEval(m, res.t[k]) - sim[k]));
  }
  m.deviation = (dev / sc) * 100;
  return m;
}

const sgn = (x: number) => (x < 0 ? '−' : '+');
const waveAt0 = (e: NetElement) => {
  const p = e.params;
  if (p.mode === 'AC' || p.mode === 'SINE_U') return Number(p.amp ?? 0) * Math.sin((Number(p.phase ?? 0) * Math.PI) / 180);
  if (p.mode === 'STEP') return Number(p.w1 ?? 0);
  if (p.mode === 'EXP') return Number(p.wk ?? 0);
  return Number(p.value ?? 0);
};
const valueAfter = (e: NetElement) => (e.params.mode === 'STEP' ? Number(e.params.w1 ?? 0) : Number(e.params.value ?? 0));
