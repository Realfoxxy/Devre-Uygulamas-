// Örnekler menüsündeki her devre hatasız çözülmeli; bazılarında beklenen değerler kontrol edilir.
import { describe, expect, it } from 'vitest';
import { BOOK } from '../src/core/exampleBook';
import { buildNetlist } from '../src/core/netlist';
import type { DCResult } from '../src/core/results';
import { analyze } from '../src/solver/analyze';

const run = (name: string) => {
  const ex = BOOK.find((e) => e.name === name)!;
  return analyze(buildNetlist(ex.doc.components, ex.doc.wires), ex.doc.analysis);
};

describe('Örnek devreler', () => {
  it.each(BOOK.map((e) => [e.group, e.name]))('%s — %s hatasız çözülür', (_g, name) => {
    const out = run(name as string);
    expect(out.issues.filter((i) => i.level === 'error').map((i) => i.message)).toEqual([]);
    expect(out.ok).toBe(true);
  });

  it('op-amp örneklerinin çıkışları', () => {
    const v = (n: string) => ((run(n).result as DCResult).comps.OA1.V);
    expect(v('Evirmeyen yükselteç')).toBeCloseTo(5, 9);
    expect(v('Gerilim izleyici')).toBeCloseTo(2, 9);
    expect(v('Toplayıcı')).toBeCloseTo(-3, 9);
    expect(v('Fark yükselteci')).toBeCloseTo(4, 9);
  });

  it('potansiyometre ve sıcaklık sensörü örnekleri', () => {
    expect((run('Potansiyometre').result as DCResult).comps.VM1.V).toBeCloseTo(3, 6);
    expect((run('Sıcaklık sensörü').result as DCResult).comps.R1.V).toBeCloseTo(2.9815, 6);
  });

  it('her grubun en az bir örneği var (Bölüm 1–9)', () => {
    const groups = new Set(BOOK.map((e) => e.group));
    for (const g of ['Bölüm 1–2', 'Bölüm 3', 'Bölüm 4', 'Bölüm 5', 'Bölüm 6', 'Bölüm 7', 'Bölüm 8', 'Bölüm 9']) expect([...groups].some((x) => x.startsWith(g))).toBe(true);
  });
});
