// Mühendislik birimleri: "4k7", "10m", "100u", "2.2n" gibi değerleri ayırır ve
// sonuçları mühendislik önekiyle 3 anlamlı basamakla yazar.

const PREFIX: Record<string, number> = {
  f: 1e-15,
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  'µ': 1e-6,
  'μ': 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  meg: 1e6,
  M: 1e6,
  G: 1e9,
  T: 1e12,
};

const UNIT_SUFFIX = /(ohms?|Ohms?|OHMS?|Ω|Hz|hz|HZ|°|deg|F|H|V|A|W|s)$/;
const NUMBER_RE =
  /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(meg|MEG|Meg|[fpnuµμmkKMGT])?(\d+)?$/;

/** "4k7" → 4700, "10m" → 0.01, "100uF" → 1e-4. Geçersizse null. */
export function parseValue(input: string): number | null {
  let s = String(input).trim().replace(/\s+/g, '').replace(',', '.');
  if (!s) return null;
  // Birimi (Ω, F, H, V, A, Hz…) at; önek harfleri korunur (m, M, f küçük harf).
  for (let i = 0; i < 2; i++) {
    const stripped = s.replace(UNIT_SUFFIX, '');
    if (stripped === s || stripped === '') break;
    s = stripped;
  }
  const m = NUMBER_RE.exec(s);
  if (!m) return null;
  const [, num, prefix, tail] = m;
  let base: number;
  if (tail) {
    // 4k7 biçimi: yalnızca tam sayı + önek + rakamlar
    if (!prefix || !/^[+-]?\d+$/.test(num)) return null;
    base = parseFloat(`${num}.${tail}`);
  } else {
    base = parseFloat(num);
  }
  const mult = prefix ? PREFIX[prefix.toLowerCase() === 'meg' ? 'meg' : prefix] : 1;
  const v = base * mult;
  return Number.isFinite(v) ? v : null;
}

const PREFIX_SYMBOL: Record<number, string> = {
  [-15]: 'f',
  [-12]: 'p',
  [-9]: 'n',
  [-6]: 'µ',
  [-3]: 'm',
  0: '',
  3: 'k',
  6: 'M',
  9: 'G',
  12: 'T',
};

/** Sayıyı mühendislik önekiyle yazar: 0.00472, "A" → "4.72 mA". */
export function formatEng(value: number, unit = '', sig = 3, space = true): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  const sep = space ? ' ' : '';
  if (Math.abs(value) < 1e-13) return `0${sep}${unit}`.trim();
  let exp = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
  exp = Math.max(-15, Math.min(12, exp));
  let scaled = value / Math.pow(10, exp);
  let txt = scaled.toPrecision(sig);
  if (Math.abs(parseFloat(txt)) >= 1000 && exp < 12) {
    exp += 3;
    scaled = value / Math.pow(10, exp);
    txt = scaled.toPrecision(sig);
  }
  if (txt.includes('e')) txt = String(parseFloat(txt));
  txt = txt.replace('-', '−');
  return `${txt}${sep}${PREFIX_SYMBOL[exp]}${unit}`;
}

/** Düzenleme kutusu için kısa yazım: 4700 → "4.7k", 1e-4 → "100u". */
export function formatInput(value: number | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '';
  if (value === 0) return '0';
  let exp = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
  exp = Math.max(-15, Math.min(12, exp));
  const scaled = value / Math.pow(10, exp);
  const txt = String(parseFloat(scaled.toPrecision(6)));
  const sym = PREFIX_SYMBOL[exp] === 'µ' ? 'u' : PREFIX_SYMBOL[exp];
  return `${txt}${sym}`;
}

/** Yüzde hata: |ölçülen − hesaplanan| / |hesaplanan| × 100 */
export function percentError(measured: number, computed: number): number | null {
  if (!Number.isFinite(measured) || !Number.isFinite(computed)) return null;
  if (Math.abs(computed) < 1e-15) return null;
  return (Math.abs(measured - computed) / Math.abs(computed)) * 100;
}
