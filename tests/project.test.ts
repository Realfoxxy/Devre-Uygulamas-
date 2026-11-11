import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/core/examples';
import { buildNetlist } from '../src/core/netlist';
import type { DCResult, TranResult } from '../src/core/results';
import { analyze } from '../src/solver/analyze';
import { deserialize, safeFileName, serialize } from '../src/storage/project';

describe('.devre proje dosyası', () => {
  it('indirilip yeniden açılan devre aynı sonucu verir', () => {
    for (const ex of EXAMPLES) {
      const back = deserialize(serialize(ex.doc));
      const a = analyze(buildNetlist(ex.doc.components, ex.doc.wires), ex.doc.analysis);
      const b = analyze(buildNetlist(back.components, back.wires), back.analysis);
      expect(a.ok, ex.name).toBe(true);
      expect(b.ok).toBe(true);
      if (a.result!.kind === 'dc') expect((b.result as DCResult).nodeV).toEqual((a.result as DCResult).nodeV);
      if (a.result!.kind === 'transient')
        expect(Array.from((b.result as TranResult).nodeV[1])).toEqual(Array.from((a.result as TranResult).nodeV[1]));
    }
  });

  it('dokümandaki örnek dosyayı okur', () => {
    const doc = deserialize(`{
      "version": 1, "meta": { "deney": "RC Devresi Şarj", "tarih": "2026-11-11" },
      "components": [
        { "id": "V1", "type": "V", "x": 100, "y": 200, "rot": 90, "params": { "mode": "DC", "value": 12 } },
        { "id": "GND1", "type": "GND", "x": 100, "y": 300, "rot": 0, "params": {} }
      ],
      "wires": [ { "from": [100, 160], "to": [160, 100] } ],
      "analysis": { "type": "transient", "t_stop": 0.5, "h": null },
      "measured": { "C1": { "V": 7.5 } }
    }`);
    expect(doc.components[0].params.value).toBe(12);
    expect(doc.wires[0].id).toBe('w1');
    expect(doc.analysis.type).toBe('transient');
    expect(doc.analysis.tStop).toBe(0.5);
    expect(doc.measured.C1.V).toBe(7.5);
  });

  it('eski / bozuk dosyaları reddeder', () => {
    expect(() => deserialize('{"version": 2, "components": []}')).toThrow();
    expect(() => deserialize('merhaba')).toThrow();
  });

  it('dosya adı Türkçe karakterlerden arındırılır', () => {
    expect(safeFileName('RC Alçak Geçiren Filtre', 'devre')).toBe('RC-Alcak-Geciren-Filtre');
    expect(safeFileName('  ', 'devre')).toBe('devre');
  });
});

describe('örnek devreler', () => {
  it('Wheatstone köprüsü: voltmetre köprü gerilimini ölçer', () => {
    const ex = EXAMPLES.find((e) => e.name.startsWith('Wheatstone'))!.doc;
    const out = analyze(buildNetlist(ex.components, ex.wires), ex.analysis);
    const r = out.result as DCResult;
    const va = (10 * 2200) / 3200;
    const vb = (10 * 3300) / 4800;
    expect(r.comps.VM1.V).toBeCloseTo(va - vb, 9);
  });
});
