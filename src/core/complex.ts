// JavaScript'te yerleşik karmaşık sayı olmadığı için küçük bir yardımcı modül.
export interface Complex {
  re: number;
  im: number;
}

export const cx = (re: number, im = 0): Complex => ({ re, im });
export const ZERO: Complex = { re: 0, im: 0 };
export const ONE: Complex = { re: 1, im: 0 };

export const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
export const mul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
export const div = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
export const neg = (a: Complex): Complex => ({ re: -a.re, im: -a.im });
export const conj = (a: Complex): Complex => ({ re: a.re, im: -a.im });
export const scale = (a: Complex, k: number): Complex => ({ re: a.re * k, im: a.im * k });
export const inv = (a: Complex): Complex => div(ONE, a);
export const abs = (a: Complex): number => Math.hypot(a.re, a.im);
export const arg = (a: Complex): number => Math.atan2(a.im, a.re);
export const argDeg = (a: Complex): number => {
  if (abs(a) < 1e-15) return 0;
  return (arg(a) * 180) / Math.PI;
};
export const fromPolar = (mag: number, deg: number): Complex => {
  const r = (deg * Math.PI) / 180;
  return { re: mag * Math.cos(r), im: mag * Math.sin(r) };
};
export const isZero = (a: Complex): boolean => a.re === 0 && a.im === 0;
