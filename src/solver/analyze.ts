// Analiz giriş noktası: doğrulama + DC / AC / geçici çözüm.
import type { AnalysisSettings } from '../core/circuit';
import type { Issue, Netlist } from '../core/netlist';
import type { AnalyzeOutput } from '../core/results';
import { resolveAcFrequency, solveAC } from './ac';
import { solveDC } from './dc';
import { SingularMatrixError } from './lu';
import { solveTransient } from './transient';
import { validateTopology } from './validate';

export function analyze(nl: Netlist, settings: AnalysisSettings): AnalyzeOutput {
  const issues: Issue[] = [...nl.issues];
  const info: string[] = [];
  const fail = (): AnalyzeOutput => ({ ok: false, issues, settings, info });
  if (issues.some((i) => i.level === 'error')) return fail();
  issues.push(...validateTopology(nl, settings.type));
  if (issues.some((i) => i.level === 'error')) return fail();

  const hasAC = nl.elements.some((e) => (e.type === 'V' || e.type === 'I') && e.params.mode === 'AC');
  try {
    if (settings.type === 'dc') {
      if (hasAC) info.push('DC analizde AC kaynaklar 0 kabul edildi.');
      return { ok: true, result: solveDC(nl), issues, settings, info };
    }
    if (settings.type === 'ac') {
      const { freq, error } = resolveAcFrequency(nl, settings);
      if (!freq) {
        issues.push({ level: 'error', message: error!, compIds: [] });
        return fail();
      }
      if (nl.elements.some((e) => (e.type === 'V' || e.type === 'I') && e.params.mode !== 'AC'))
        info.push('AC analizde DC kaynaklar sıfırlandı (gerilim kaynağı kısa, akım kaynağı açık devre).');
      if (!hasAC) info.push('Devrede AC kaynak yok; tüm fazörler 0.');
      return { ok: true, result: solveAC(nl, settings, freq), issues, settings, info };
    }
    const { result, info: tinfo } = solveTransient(nl, settings);
    info.push(...tinfo);
    return { ok: true, result, issues, settings, info };
  } catch (err) {
    if (err instanceof SingularMatrixError) {
      issues.push({
        level: 'error',
        message:
          'Çözülemeyen devre: MNA matrisi tekil çıktı. Paralel gerilim kaynakları, seri akım kaynakları ya da toprağa bağlı olmayan bir bölüm olabilir.',
        compIds: [],
      });
      return fail();
    }
    throw err;
  }
}
