// Enerji: w = ∫ p dt (Bölüm 1.5, 7.3, 7.6). Pasif işaret kuralıyla p = v·i; pozitif → soğurulan.

type TranComp = { V: ArrayLike<number>; I: ArrayLike<number>; pinV?: ArrayLike<number>[]; pinI?: ArrayLike<number>[] };

/** k. adımda soğurulan anlık güç; çok uçlu elemanlarda Σ v_k·i_k */
export function instPower(c: TranComp, k: number): number {
  if (c.pinV && c.pinI) {
    let s = 0;
    for (let j = 0; j < c.pinV.length; j++) s += c.pinV[j][k] * c.pinI[j][k];
    return s;
  }
  return c.V[k] * c.I[k];
}

/** Bileşenin [t1, t2] aralığında soğurduğu enerji */
export function compEnergy(t: ArrayLike<number>, c: TranComp, t1: number, t2: number): number {
  const p = Float64Array.from({ length: t.length }, (_, k) => instPower(c, k));
  return energyBetween(t, p, new Float64Array(t.length).fill(1), t1, t2);
}

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
