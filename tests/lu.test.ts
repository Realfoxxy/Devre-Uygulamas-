import { describe, expect, it } from 'vitest';
import { lusolve } from 'mathjs';
import { solveComplex, solveReal } from '../src/solver/lu';

function rand(n: number, seed: number) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const A = new Float64Array(n * n).map(() => r());
  const b = Array.from({ length: n }, r);
  return { A, b, r };
}

describe('LU çözücü', () => {
  it('math.js lusolve ile aynı sonucu verir', () => {
    for (const n of [3, 8, 20]) {
      const { A, b } = rand(n, n * 7 + 1);
      const x = solveReal(A, b, n);
      const rows = Array.from({ length: n }, (_, i) => Array.from(A.slice(i * n, i * n + n)));
      const ref = (lusolve(rows, b) as number[][]).map((r) => r[0]);
      ref.forEach((v, i) => expect(x[i]).toBeCloseTo(v, 9));
    }
  });

  it('karmaşık sistem: A·x = b sağlanır', () => {
    const n = 6;
    const { A: re, b: br, r } = rand(n, 99);
    const im = new Float64Array(n * n).map(() => r());
    const bi = Array.from({ length: n }, r);
    const x = solveComplex(re, im, br, bi, n);
    for (let i = 0; i < n; i++) {
      let sr = 0;
      let si = 0;
      for (let j = 0; j < n; j++) {
        sr += re[i * n + j] * x.re[j] - im[i * n + j] * x.im[j];
        si += re[i * n + j] * x.im[j] + im[i * n + j] * x.re[j];
      }
      expect(sr).toBeCloseTo(br[i], 9);
      expect(si).toBeCloseTo(bi[i], 9);
    }
  });
});
