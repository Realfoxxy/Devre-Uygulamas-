// Kısmi pivotlu LU ayrıştırma — gerçek ve karmaşık matrisler için.
// Matrisler satır-öncelikli düz diziler olarak tutulur: A[r*n + c].

export class SingularMatrixError extends Error {
  constructor(public row: number) {
    super('Matris tekil');
  }
}

export interface LUReal {
  n: number;
  lu: Float64Array;
  piv: Int32Array;
}

export function luFactor(A: Float64Array, n: number): LUReal {
  const lu = Float64Array.from(A);
  const piv = new Int32Array(n);
  let scale = 0;
  for (let i = 0; i < n * n; i++) scale = Math.max(scale, Math.abs(lu[i]));
  const tol = Math.max(scale, 1e-300) * 1e-13;
  for (let k = 0; k < n; k++) {
    // pivot seçimi: k. sütunda en büyük mutlak değer
    let p = k;
    let max = Math.abs(lu[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(lu[i * n + k]);
      if (v > max) {
        max = v;
        p = i;
      }
    }
    if (max <= tol) throw new SingularMatrixError(k);
    piv[k] = p;
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const t = lu[k * n + j];
        lu[k * n + j] = lu[p * n + j];
        lu[p * n + j] = t;
      }
    }
    const d = lu[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = (lu[i * n + k] /= d);
      if (f === 0) continue;
      for (let j = k + 1; j < n; j++) lu[i * n + j] -= f * lu[k * n + j];
    }
  }
  return { n, lu, piv };
}

export function luSolve(f: LUReal, b: ArrayLike<number>): Float64Array {
  const { n, lu, piv } = f;
  const x = Float64Array.from(b);
  for (let k = 0; k < n; k++) {
    const p = piv[k];
    if (p !== k) {
      const t = x[k];
      x[k] = x[p];
      x[p] = t;
    }
  }
  for (let i = 0; i < n; i++) {
    let s = x[i];
    for (let j = 0; j < i; j++) s -= lu[i * n + j] * x[j];
    x[i] = s;
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= lu[i * n + j] * x[j];
    x[i] = s / lu[i * n + i];
  }
  return x;
}

export function solveReal(A: Float64Array, b: ArrayLike<number>, n: number): Float64Array {
  if (n === 0) return new Float64Array(0);
  return luSolve(luFactor(A, n), b);
}

/** Karmaşık sistem: gerçek ve sanal kısımlar ayrı dizilerde. */
export function solveComplex(
  Are: Float64Array,
  Aim: Float64Array,
  bre: ArrayLike<number>,
  bim: ArrayLike<number>,
  n: number,
): { re: Float64Array; im: Float64Array } {
  const re = Float64Array.from(Are);
  const im = Float64Array.from(Aim);
  const xr = Float64Array.from(bre);
  const xi = Float64Array.from(bim);
  let scale = 0;
  for (let i = 0; i < n * n; i++) scale = Math.max(scale, Math.hypot(re[i], im[i]));
  const tol = Math.max(scale, 1e-300) * 1e-13;
  for (let k = 0; k < n; k++) {
    let p = k;
    let max = Math.hypot(re[k * n + k], im[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.hypot(re[i * n + k], im[i * n + k]);
      if (v > max) {
        max = v;
        p = i;
      }
    }
    if (max <= tol) throw new SingularMatrixError(k);
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        let t = re[k * n + j];
        re[k * n + j] = re[p * n + j];
        re[p * n + j] = t;
        t = im[k * n + j];
        im[k * n + j] = im[p * n + j];
        im[p * n + j] = t;
      }
      let t = xr[k];
      xr[k] = xr[p];
      xr[p] = t;
      t = xi[k];
      xi[k] = xi[p];
      xi[p] = t;
    }
    const dr = re[k * n + k];
    const di = im[k * n + k];
    const dd = dr * dr + di * di;
    for (let i = k + 1; i < n; i++) {
      const ar = re[i * n + k];
      const ai = im[i * n + k];
      if (ar === 0 && ai === 0) continue;
      const fr = (ar * dr + ai * di) / dd;
      const fi = (ai * dr - ar * di) / dd;
      for (let j = k + 1; j < n; j++) {
        const br = re[k * n + j];
        const bi = im[k * n + j];
        re[i * n + j] -= fr * br - fi * bi;
        im[i * n + j] -= fr * bi + fi * br;
      }
      xr[i] -= fr * xr[k] - fi * xi[k];
      xi[i] -= fr * xi[k] + fi * xr[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let sr = xr[i];
    let si = xi[i];
    for (let j = i + 1; j < n; j++) {
      const ar = re[i * n + j];
      const ai = im[i * n + j];
      sr -= ar * xr[j] - ai * xi[j];
      si -= ar * xi[j] + ai * xr[j];
    }
    const dr = re[i * n + i];
    const di = im[i * n + i];
    const dd = dr * dr + di * di;
    xr[i] = (sr * dr + si * di) / dd;
    xi[i] = (si * dr - sr * di) / dd;
  }
  return { re: xr, im: xi };
}
