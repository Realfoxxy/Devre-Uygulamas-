import { describe, expect, it } from 'vitest';
import { formatEng, formatInput, parseValue, percentError } from '../src/core/units';

describe('birim ayırma', () => {
  it.each([
    ['4k7', 4700],
    ['10m', 0.01],
    ['100u', 1e-4],
    ['100µF', 1e-4],
    ['2.2n', 2.2e-9],
    ['1M', 1e6],
    ['1meg', 1e6],
    ['12', 12],
    ['1e-6', 1e-6],
    ['5V', 5],
    ['10mH', 0.01],
    ['1kΩ', 1000],
    ['2,2k', 2200],
    ['-3.3', -3.3],
    ['1kHz', 1000],
  ])('%s → %f', (s, v) => {
    expect(parseValue(s)).toBeCloseTo(v as number, 15);
  });
  it('geçersiz', () => {
    expect(parseValue('abc')).toBeNull();
    expect(parseValue('')).toBeNull();
    expect(parseValue('1.5k7')).toBeNull();
  });
});

describe('yazım', () => {
  it('3 anlamlı basamak', () => {
    expect(formatEng(0.00472, 'A')).toBe('4.72 mA');
    expect(formatEng(8, 'V')).toBe('8.00 V');
    expect(formatEng(4700, 'Ω')).toBe('4.70 kΩ');
    expect(formatEng(0.9999, 'V')).toBe('1.00 V');
    expect(formatEng(999.95, 'Ω')).toBe('1.00 kΩ');
    expect(formatEng(-0.048, 'W')).toBe('−48.0 mW');
    expect(formatEng(0, 'A')).toBe('0 A');
  });
  it('giriş kutusu', () => {
    expect(formatInput(4700)).toBe('4.7k');
    expect(formatInput(1e-4)).toBe('100u');
  });
  it('yüzde hata', () => {
    expect(percentError(7.5, 8)).toBeCloseTo(6.25);
  });
});
