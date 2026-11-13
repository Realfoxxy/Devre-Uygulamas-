// MNA (Modified Nodal Analysis) matrisi: [G B; Bᵀ 0][v; j] = [i; e]
// Her bileşen matrise kendi "damgasını" ekler; toprak (0) satır/sütunları atlanır.
import type { Complex } from '../core/complex';
import type { SystemDump } from '../core/results';
import { SingularMatrixError, solveComplex, solveReal } from './lu';

export class MNASystem {
  readonly n: number;
  readonly N: number;
  readonly labels: string[];
  private branchIdx = new Map<string, number>();
  private Are: Float64Array;
  private Aim: Float64Array;
  bre: Float64Array;
  bim: Float64Array;
  private owners: Record<string, { cells: Set<string>; rhs: Set<number> }> = {};
  private trackOwners: boolean;

  /** true iken matris yazılmaz, yalnızca sağ taraf (geçici rejim adımları için) */
  rhsOnly = false;

  constructor(nodeCount: number, branchIds: string[], track = true, nodeLabels?: Record<number, string>) {
    this.n = nodeCount;
    this.N = nodeCount + branchIds.length;
    this.labels = [];
    for (let i = 1; i <= nodeCount; i++) this.labels.push(nodeLabels?.[i] ?? `v${i}`);
    branchIds.forEach((id, k) => {
      this.branchIdx.set(id, nodeCount + k);
      this.labels.push(`j_${id}`);
    });
    this.Are = new Float64Array(this.N * this.N);
    this.Aim = new Float64Array(this.N * this.N);
    this.bre = new Float64Array(this.N);
    this.bim = new Float64Array(this.N);
    this.trackOwners = track;
  }

  /** düğüm numarası → bilinmeyen indeksi (toprak → -1) */
  node(k: number) {
    return k - 1;
  }
  branch(id: string) {
    const b = this.branchIdx.get(id);
    if (b === undefined) throw new Error(`Dal akımı yok: ${id}`);
    return b;
  }

  private own(owner: string | undefined) {
    if (!owner || !this.trackOwners) return null;
    return (this.owners[owner] ??= { cells: new Set(), rhs: new Set() });
  }

  hasBranch(id: string) {
    return this.branchIdx.has(id);
  }

  clearRhs() {
    this.bre.fill(0);
    this.bim.fill(0);
  }

  addA(r: number, c: number, re: number, im: number, owner?: string) {
    if (r < 0 || c < 0 || this.rhsOnly) return;
    this.Are[r * this.N + c] += re;
    this.Aim[r * this.N + c] += im;
    this.own(owner)?.cells.add(`${r},${c}`);
  }
  addB(r: number, re: number, im: number, owner?: string) {
    if (r < 0) return;
    this.bre[r] += re;
    this.bim[r] += im;
    this.own(owner)?.rhs.add(r);
  }

  /** İletkenlik / admitans damgası a–b arasında */
  stampAdmittance(a: number, b: number, y: Complex, owner?: string) {
    const ia = this.node(a);
    const ib = this.node(b);
    this.addA(ia, ia, y.re, y.im, owner);
    this.addA(ib, ib, y.re, y.im, owner);
    this.addA(ia, ib, -y.re, -y.im, owner);
    this.addA(ib, ia, -y.re, -y.im, owner);
  }

  /** Akım kaynağı: I akımı kaynağın içinde a'dan b'ye akar (i[a] −= I, i[b] += I). */
  stampCurrent(a: number, b: number, I: Complex, owner?: string) {
    this.addB(this.node(a), -I.re, -I.im, owner);
    this.addB(this.node(b), I.re, I.im, owner);
  }

  /** Gerilim kaynağı (+a, −b): B[a,k] = 1, B[b,k] = −1, e[k] = V */
  stampVoltage(a: number, b: number, id: string, V: Complex, owner?: string) {
    const k = this.branch(id);
    const ia = this.node(a);
    const ib = this.node(b);
    this.addA(ia, k, 1, 0, owner);
    this.addA(k, ia, 1, 0, owner);
    this.addA(ib, k, -1, 0, owner);
    this.addA(k, ib, -1, 0, owner);
    this.addB(k, V.re, V.im, owner);
  }

  /**
   * Gerilim kaynağı + seri empedans dalı: v_a − v_b − Z·j = V.
   * Z = 0 ideal kaynak; gerçek ampermetre, akımı ölçülen L / C bu biçimde damgalanır.
   */
  stampBranch(a: number, b: number, id: string, V: Complex, Z: Complex, owner?: string) {
    this.stampVoltage(a, b, id, V, owner);
    if (Z.re !== 0 || Z.im !== 0) {
      const k = this.branch(id);
      this.addA(k, k, -Z.re, -Z.im, owner);
    }
  }

  /** Değeri bilinen akım dalı: j = I (dal akımı başka bir eleman tarafından okunabilsin diye) */
  stampCurrentBranch(a: number, b: number, id: string, I: Complex, owner?: string) {
    const k = this.branch(id);
    this.addA(this.node(a), k, 1, 0, owner);
    this.addA(this.node(b), k, -1, 0, owner);
    this.addA(k, k, 1, 0, owner);
    this.addB(k, I.re, I.im, owner);
  }

  /** Gerilim kontrollü gerilim kaynağı (E): v_a − v_b = A·(v_c − v_d) */
  stampVCVS(a: number, b: number, c: number, d: number, id: string, A: number, owner?: string) {
    this.stampVoltage(a, b, id, { re: 0, im: 0 }, owner);
    const k = this.branch(id);
    this.addA(k, this.node(c), -A, 0, owner);
    this.addA(k, this.node(d), A, 0, owner);
  }

  /** Gerilim kontrollü akım kaynağı (G): içinde a'dan b'ye G·(v_c − v_d) */
  stampVCCS(a: number, b: number, c: number, d: number, G: number, owner?: string) {
    const ia = this.node(a);
    const ib = this.node(b);
    this.addA(ia, this.node(c), G, 0, owner);
    this.addA(ia, this.node(d), -G, 0, owner);
    this.addA(ib, this.node(c), -G, 0, owner);
    this.addA(ib, this.node(d), G, 0, owner);
  }

  /** Akım kontrollü akım kaynağı (F): içinde a'dan b'ye B·j_m */
  stampCCCS(a: number, b: number, ctrlBranch: string, B: number, owner?: string) {
    const m = this.branch(ctrlBranch);
    this.addA(this.node(a), m, B, 0, owner);
    this.addA(this.node(b), m, -B, 0, owner);
  }

  /** Akım kontrollü gerilim kaynağı (H): v_a − v_b = R_m·j_m */
  stampCCVS(a: number, b: number, id: string, ctrlBranch: string, Rm: number, owner?: string) {
    this.stampVoltage(a, b, id, { re: 0, im: 0 }, owner);
    this.addA(this.branch(id), this.branch(ctrlBranch), -Rm, 0, owner);
  }

  /** İdeal op-amp: çıkış dalı akımı k; v_+ = v_− kısıtı */
  stampIdealOpAmp(o: number, p: number, n: number, id: string, owner?: string) {
    const k = this.branch(id);
    this.addA(this.node(o), k, 1, 0, owner);
    this.addA(k, this.node(p), 1, 0, owner);
    this.addA(k, this.node(n), -1, 0, owner);
  }

  realMatrix() {
    return this.Are;
  }

  solveReal(): Float64Array {
    return solveReal(this.Are, this.bre, this.N);
  }

  solveComplex(): { re: Float64Array; im: Float64Array } {
    if (this.N === 0) return { re: new Float64Array(0), im: new Float64Array(0) };
    return solveComplex(this.Are, this.Aim, this.bre, this.bim, this.N);
  }

  dump(x: { re: ArrayLike<number>; im?: ArrayLike<number> }, complex: boolean, note: string): SystemDump {
    const N = this.N;
    const val = (re: number, im: number): number | [number, number] => (complex ? [re, im] : re);
    const A: (number | [number, number])[][] = [];
    for (let r = 0; r < N; r++) {
      const row: (number | [number, number])[] = [];
      for (let c = 0; c < N; c++) row.push(val(this.Are[r * N + c], this.Aim[r * N + c]));
      A.push(row);
    }
    const b = Array.from({ length: N }, (_, i) => val(this.bre[i], this.bim[i]));
    const xs = Array.from({ length: N }, (_, i) => val(x.re[i], x.im ? x.im[i] : 0));
    const owners: SystemDump['owners'] = {};
    for (const [id, o] of Object.entries(this.owners)) {
      owners[id] = {
        cells: [...o.cells].map((s) => s.split(',').map(Number) as [number, number]),
        rhs: [...o.rhs],
      };
    }
    return { labels: [...this.labels], A, b, x: xs, owners, complex, note };
  }
}

export { SingularMatrixError };
