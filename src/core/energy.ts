// Enerji: w = ∫ p dt (Bölüm 1.5, 7.3, 7.6). Pasif işaret kuralıyla p = v·i; pozitif → soğurulan.
export function energyBetween(t: ArrayLike<number>, V: ArrayLike<number>, I: ArrayLike<number>, t1: number, t2: number): number {
  const a = Math.min(t1, t2);
  const b = Math.max(t1, t2);
  let w = 0;
  for (let k = 1; k < t.length; k++) {
    const x0 = Math.max(a, t[k - 1]);
    const x1 = Math.min(b, t[k]);
    if (x1 <= x0) continue;
    // adım içinde p doğrusal kabul edilir (trapez kuralı)
    const p0 = V[k - 1] * I[k - 1];
    const p1 = V[k] * I[k];
    const dt = t[k] - t[k - 1];
    const pAt = (x: number) => p0 + ((p1 - p0) * (x - t[k - 1])) / dt;
    w += ((pAt(x0) + pAt(x1)) / 2) * (x1 - x0);
  }
  return w;
}
