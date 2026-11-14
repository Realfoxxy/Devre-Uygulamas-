// Analiz giriş noktası: doğrulama + DC / AC / geçici çözüm.
import type { AnalysisSettings } from '../core/circuit';
import type { Issue, Netlist } from '../core/netlist';
import type { AnalyzeOutput } from '../core/results';
import { resolveAcFrequency, solveAC } from './ac';
import { solveDC } from './dc';
import { SingularMatrixError } from './lu';
import { solveTransient } from './transient';
import { validateControls, validateTopology } from './validate';
import { isDependent } from '../core/circuit';
import type { AnalysisResult } from '../core/results';
import { abs } from '../core/complex';
import { formatEng } from '../core/units';

export function analyze(nl: Netlist, settings: AnalysisSettings): AnalyzeOutput {
  const issues: Issue[] = [...nl.issues];
  const info: string[] = [];
  const fail = (): AnalyzeOutput => ({ ok: false, issues, settings, info });
  if (issues.some((i) => i.level === 'error')) return fail();
  issues.push(...validateControls(nl));
  if (issues.some((i) => i.level === 'error')) return fail();
  issues.push(...validateTopology(nl, settings.type));
  if (issues.some((i) => i.level === 'error')) return fail();

  const hasAC = nl.elements.some((e) => (e.type === 'V' || e.type === 'I') && e.params.mode === 'AC');
  try {
    if (settings.type === 'dc') {
      if (hasAC) info.push('DC analizde AC kaynaklar 0 kabul edildi.');
      const result = solveDC(nl);
      postChecks(nl, result, issues, info);
      return { ok: true, result, issues, settings, info };
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
      const result = solveAC(nl, settings, freq);
      postChecks(nl, result, issues, info);
      return { ok: true, result, issues, settings, info };
    }
    const { result, info: tinfo } = solveTransient(nl, settings);
    info.push(...tinfo);
    postChecks(nl, result, issues, info);
    return { ok: true, result, issues, settings, info };
  } catch (err) {
    if (err instanceof SingularMatrixError) {
      const opamps = nl.elements.filter((e) => e.type === 'OA' && (e.params.model ?? 'ideal') !== 'finite');
      if (opamps.length) {
        issues.push({
          level: 'error',
          message: `${opamps.map((o) => o.id).join(', ')}: op-amp'ın negatif geri beslemesi yok; ideal modelle çözülemez. Çıkıştan − girişe bir direnç (geri besleme) bağlayın ya da sonlu kazanç modelini seçin.`,
          compIds: opamps.map((o) => o.id),
        });
        return fail();
      }
      const culprit = blameAlgebraicLoop(nl, settings);
      if (culprit) {
        issues.push({
          level: 'error',
          message: `${culprit}'in kazancı bu değerde devreyi çözümsüz yapıyor (cebirsel döngü): denklemler birbiriyle çelişiyor. ${culprit}'in kazancını değiştirin.`,
          compIds: [culprit],
        });
        return fail();
      }
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

/** Tekil matrisin sorumlusu olan bağımlı kaynağı bulur: kazancı biraz değişince devre çözülüyorsa odur. */
function blameAlgebraicLoop(nl: Netlist, settings: AnalysisSettings): string | null {
  for (const e of nl.elements) {
    if (!isDependent(e.type)) continue;
    const g = Number(e.params.gain ?? 0);
    const tweaked: Netlist = {
      ...nl,
      elements: nl.elements.map((x) => (x.id === e.id ? { ...x, params: { ...x.params, gain: g === 0 ? 1e-3 : g * 1.1 } } : x)),
    };
    try {
      if (settings.type === 'ac') {
        const { freq } = resolveAcFrequency(tweaked, settings);
        solveAC(tweaked, { ...settings, sweep: false }, freq ?? 1000);
      } else solveDC(tweaked);
      return e.id;
    } catch {
      /* hâlâ tekil */
    }
  }
  return null;
}

/** Çözüm sonrası uyarılar: op-amp doyumu, sıcaklık sensörü çalışma aralığı, sonlu kazanç farkı, ölçü aleti yüklemesi. */
function postChecks(nl: Netlist, res: AnalysisResult, issues: Issue[], info: string[]) {
  const warn = (message: string, id: string) => issues.push({ level: 'warning', message, compIds: [id] });
  for (const e of nl.elements) {
    if (e.type === 'OA') {
      const vsat = Number(e.params.vsat ?? 15);
      const isat = Number(e.params.isat ?? 10e-3);
      const slew = Number(e.params.slew ?? 0.5e6);
      let vmax = 0;
      let imax = 0;
      let dv = 0;
      if (res.kind === 'dc') {
        vmax = Math.abs(res.comps[e.id].V);
        imax = Math.abs(res.comps[e.id].I);
      } else if (res.kind === 'ac') {
        vmax = abs(res.comps[e.id].V);
        imax = abs(res.comps[e.id].I);
        dv = vmax * 2 * Math.PI * res.freq;
      } else {
        const c = res.comps[e.id];
        for (let k = 0; k < c.V.length; k++) {
          vmax = Math.max(vmax, Math.abs(c.V[k]));
          imax = Math.max(imax, Math.abs(c.I[k]));
          if (k > 0) dv = Math.max(dv, Math.abs(c.V[k] - c.V[k - 1]) / res.h);
        }
      }
      if (vmax > vsat) warn(`${e.id}: çıkış ${formatEng(vmax, 'V')}. Gerçek bir op-amp burada doyuma girerdi (±${formatEng(vsat, 'V')}).`, e.id);
      if (imax > isat) warn(`${e.id}: çıkış akımı ${formatEng(imax, 'A')}; gerçek bir op-amp ${formatEng(isat, 'A')} üzerinde akım veremez.`, e.id);
      if (dv > slew && res.kind !== 'dc')
        warn(`${e.id}: çıkış ${formatEng(dv, 'V/s')} hızla değişiyor; gerçek op-amp'ın eğim hızı (${formatEng(slew, 'V/s')}) bunu izleyemez.`, e.id);
    }
    if (e.type === 'TS' && res.kind !== 'ac') {
      const lo = Number(e.params.vmin ?? 4);
      const hi = Number(e.params.vmax ?? 30);
      const v = res.kind === 'dc' ? [res.comps[e.id].V] : Array.from(res.comps[e.id].V);
      const bad = v.find((x) => Math.abs(x) < lo || Math.abs(x) > hi);
      if (bad !== undefined)
        warn(`${e.id}: uçlarındaki gerilim ${formatEng(Math.abs(bad), 'V')}; sensörün çalışma aralığı ${formatEng(lo, 'V')} – ${formatEng(hi, 'V')}.`, e.id);
    }
  }
  if (res.kind !== 'dc') return;
  // Sonlu kazanç / ofsetli op-amp: ideal modelle fark
  const nonIdeal = nl.elements.filter((e) => e.type === 'OA' && (e.params.model ?? 'ideal') !== 'ideal');
  if (nonIdeal.length) {
    try {
      const ideal = solveDC({ ...nl, elements: nl.elements.map((e) => (e.type === 'OA' ? { ...e, params: { ...e.params, model: 'ideal' as const } } : e)) });
      for (const e of nonIdeal) {
        const vi = ideal.comps[e.id].V;
        const vr = res.comps[e.id].V;
        const d = Math.abs(vi) > 1e-12 ? (Math.abs(vr - vi) / Math.abs(vi)) * 100 : 0;
        info.push(`${e.id}: ideal modelde çıkış ${formatEng(vi, 'V')}, ${e.params.model === 'finite' ? 'sonlu kazançla' : 'ofsetle'} ${formatEng(vr, 'V')} — fark %${d.toPrecision(2)}.`);
      }
    } catch {
      /* ideal model çözülemedi */
    }
  }
  // Gerçek ölçü aletleri: ideal aletle okunacak değer
  const meters = nl.elements.filter((e) => (e.type === 'VM' || e.type === 'AM') && e.params.real);
  if (meters.length) {
    try {
      const ideal = solveDC({ ...nl, elements: nl.elements.map((e) => (e.type === 'VM' || e.type === 'AM' ? { ...e, params: { ...e.params, real: false } } : e)) });
      res.idealMeters = {};
      for (const m of meters) res.idealMeters[m.id] = m.type === 'VM' ? ideal.comps[m.id].V : ideal.comps[m.id].I;
    } catch {
      /* yok say */
    }
  }
}
