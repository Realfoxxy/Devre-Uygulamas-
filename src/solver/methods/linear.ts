// Doğrusal ifade: Σ c_k · x_k + k (x: v1, v2 … ya da i1, i2 …). Denklem metni ve matris için ortak.

export interface Lin {
  c: Map<string, number>;
  k: number;
}

export const lin = (k = 0, terms: [string, number][] = []): Lin => ({ c: new Map(terms), k });
export const linVar = (name: string, coef = 1): Lin => lin(0, [[name, coef]]);

export function linAdd(a: Lin, b: Lin, s = 1): Lin {
  const c = new Map(a.c);
  for (const [n, v] of b.c) c.set(n, (c.get(n) ?? 0) + s * v);
  return { c, k: a.k + s * b.k };
}

export function linScale(a: Lin, s: number): Lin {
  const c = new Map<string, number>();
  for (const [n, v] of a.c) c.set(n, v * s);
  return { c, k: a.k * s };
}

/** Sayıların kısa yazımı: 1000 → 1k, 0.001 → 1m, 0.25 → 0.25 (kayan nokta artıkları görünmez). */
export function num(x: number): string {
  if (!Number.isFinite(x)) return '?';
  if (Math.abs(x) < 1e-14) return '0';
  const a = Math.abs(x);
  let s: string;
  if (a >= 1000 || a < 0.01) {
    let exp = Math.floor(Math.log10(a) / 3) * 3;
    exp = Math.max(-15, Math.min(12, exp));
    let m = parseFloat((a / Math.pow(10, exp)).toPrecision(4));
    if (m >= 1000) {
      exp += 3;
      m = parseFloat((m / 1000).toPrecision(4));
    }
    s = `${m}${PREFIX[exp] ?? `e${exp}`}`;
  } else s = String(parseFloat(a.toPrecision(4)));
  return (x < 0 ? '−' : '') + s;
}

const PREFIX: Record<number, string> = { [-15]: 'f', [-12]: 'p', [-9]: 'n', [-6]: 'µ', [-3]: 'm', 0: '', 3: 'k', 6: 'M', 9: 'G', 12: 'T' };

/** Bir terimin işaretini değiştirir: tek terimse başına − koyar / kaldırır, bileşikse parantez içine alır. */
export function negateText(t: string): string {
  if (t.startsWith('−')) {
    const rest = t.slice(1);
    return /[+−] /.test(rest) && !/^\(.*\)$/.test(rest) ? `(${t})` : rest;
  }
  if (/ [+−] /.test(t) && !/^\(.*\)(\/\S+)?$/.test(t)) return `−(${t})`;
  return `−${t}`;
}

/** "6·i1 − 4·i2" biçiminde terimler (sabit hariç). */
export function linTerms(a: Lin, order: string[]): string {
  const parts: string[] = [];
  for (const n of order) {
    const v = a.c.get(n) ?? 0;
    if (Math.abs(v) < 1e-12) continue;
    const mag = Math.abs(v);
    const body = Math.abs(mag - 1) < 1e-12 ? n : `${num(mag)}·${n}`;
    parts.push(parts.length === 0 ? (v < 0 ? `−${body}` : body) : `${v < 0 ? '−' : '+'} ${body}`);
  }
  return parts.join(' ') || '0';
}

/** Sadeleşmiş denklem: "6·i1 − 4·i2 = 10" (lhs = 0 biçimindeki ifadeden). */
export function linEquation(a: Lin, order: string[]): string {
  return `${linTerms(a, order)} = ${num(-a.k)}`;
}

/** Denklemleri matris biçimine çevirir: A·x = b (her satır lhs = 0 biçiminde). */
export function linSystem(rows: Lin[], order: string[]): { A: number[][]; b: number[] } {
  return {
    A: rows.map((r) => order.map((n) => clean(r.c.get(n) ?? 0))),
    b: rows.map((r) => clean(-r.k)),
  };
}

const clean = (x: number) => (Math.abs(x) < 1e-14 ? 0 : x);

/** Küçük yoğun sistem için Gauss eliminasyonu (kısmi pivot). Tekilse null. */
export function solveDense(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (Math.abs(M[p][k]) < 1e-12) return null;
    [M[k], M[p]] = [M[p], M[k]];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/** Metin terimi + doğrusal karşılığı */
export interface Term {
  text: string;
  lin: Lin;
}

/** Terimleri "a + b − c" biçiminde birleştirir; metni '−' ile başlayan terimler eksiyle bağlanır. */
export function joinTerms(texts: string[]): string {
  let out = '';
  for (const t of texts) {
    if (!t) continue;
    if (!out) out = t;
    else if (t.startsWith('−')) out += ` − ${t.slice(1)}`;
    else out += ` + ${t}`;
  }
  return out || '0';
}
