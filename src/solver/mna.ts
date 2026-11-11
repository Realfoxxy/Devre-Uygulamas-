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

  constructor(nodeCount: number, branchIds: string[], track = true) {
    this.n = nodeCount;
    this.N = nodeCount + branchIds.length;
    this.labels = [];
    for (let i = 1; i <= nodeCount; i++) this.labels.push(`v${i}`);
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

  addA(r: number, c: number, re: number, im: number, owner?: string) {
    if (r < 0 || c < 0) return;
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
