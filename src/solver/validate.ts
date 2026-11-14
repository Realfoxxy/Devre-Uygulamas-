// Çözümden önce topolojik kontroller: gerilim kaynağı döngüleri ve
// gerilimi belirlenemeyen (yalnızca akım kaynağı / kapasitör üzerinden bağlı) düğümler.
import { AnalysisType, CURRENT_CTRL_TYPES, PARTS, VOLTAGE_CTRL_TYPES, ctrlKindOf, isDependent } from '../core/circuit';
import type { Issue, Netlist, NetElement } from '../core/netlist';

/** Bu analizde dal akımı bilinmeyeni olan (gerilim tipi) elemanlar */
export function isVoltageType(e: NetElement, mode: AnalysisType | 'tau'): boolean {
  if (e.type === 'AM') return !e.params.real;
  if (e.type === 'V' || e.type === 'E' || e.type === 'H' || e.type === 'OA') return true;
  if (e.type === 'L' && (mode === 'dc' || mode === 'tau')) return true;
  return false;
}

export function validateTopology(nl: Netlist, mode: AnalysisType): Issue[] {
  const issues: Issue[] = [];
  const parent = Array.from({ length: nl.nodeCount + 1 }, (_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));

  const vt = nl.elements.filter((e) => isVoltageType(e, mode));
  // op-amp çıkışı toprağa göre bir gerilim kaynağı gibidir
  const vpair = (e: NetElement): [number, number] => (e.type === 'OA' ? [e.nodes[2], 0] : [e.nodes[0], e.nodes[1]]);
  for (const e of vt) {
    const [a, b] = vpair(e);
    if (a === b) {
      const what =
        e.type === 'V'
          ? `${e.id} gerilim kaynağının iki ucu kısa devre edilmiş.`
          : e.type === 'AM'
            ? `${e.id} ampermetresinin iki ucu aynı düğümde; içinden geçen akım belirsiz.`
            : e.type === 'OA'
              ? `${e.id} op-amp'ının çıkışı doğrudan toprağa bağlı.`
              : `${e.id} bobininin iki ucu aynı düğümde; DC'de akımı belirsiz.`;
      issues.push({ level: 'error', message: `Çözülemeyen devre: ${what}`, compIds: [e.id] });
      continue;
    }
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) {
      const loop = vt.filter((o) => vpair(o)[0] !== vpair(o)[1] && find(vpair(o)[0]) === ra).map((o) => o.id);
      const hasL = vt.some((o) => o.type === 'L' && loop.includes(o.id));
      issues.push({
        level: 'error',
        message:
          `Çözülemeyen devre: ${loop.join(', ')} bir döngü oluşturuyor ` +
          `(paralel bağlı gerilim kaynakları / ampermetreler${hasL ? ' — DC’de bobin kısa devre sayılır' : ''}).`,
        compIds: loop,
      });
    } else parent[ra] = rb;
  }

  // Toprağa "gerilim belirleyen" bir yol olmayan düğümler
  const adj: number[][] = Array.from({ length: nl.nodeCount + 1 }, () => []);
  const link = (a: number, b: number) => {
    adj[a].push(b);
    adj[b].push(a);
  };
  for (const e of nl.elements) {
    if (e.type === 'I' || e.type === 'G' || e.type === 'F' || e.type === 'TS') continue;
    if (e.type === 'VM' && !e.params.real) continue;
    if (e.type === 'C' && mode === 'dc') continue;
    const [a, b, c] = e.nodes;
    if (e.type === 'POT') {
      link(a, c);
      link(c, b);
    } else if (e.type === 'SW2') {
      link(a, b);
      link(a, c);
    } else if (e.type === 'OA') {
      link(c, 0);
      if (e.params.model === 'finite') link(a, b);
    } else link(a, b);
  }
  const seen = new Array(nl.nodeCount + 1).fill(false);
  const stack = [0];
  seen[0] = true;
  while (stack.length) {
    const u = stack.pop()!;
    for (const v of adj[u])
      if (!seen[v]) {
        seen[v] = true;
        stack.push(v);
      }
  }
  const bad: number[] = [];
  for (let k = 1; k <= nl.nodeCount; k++) if (!seen[k]) bad.push(k);
  if (bad.length) {
    const comps = nl.elements.filter((e) => e.nodes.some((n) => bad.includes(n))).map((e) => e.id);
    const viaC = mode === 'dc' && nl.elements.some((e) => e.type === 'C' && e.nodes.some((n) => bad.includes(n)));
    const viaI = nl.elements.some((e) => e.type === 'I' && e.nodes.some((n) => bad.includes(n)));
    const reasons = [viaI && 'akım kaynağı', viaC && 'kapasitör (DC’de açık devre)', 'voltmetre']
      .filter(Boolean)
      .join(' / ');
    issues.push({
      level: 'error',
      message:
        `Çözülemeyen devre: düğüm ${bad.join(', ')} toprağa yalnızca ${reasons} üzerinden bağlı ya da hiç bağlı değil; ` +
        `gerilimi belirlenemiyor.`,
      compIds: comps,
    });
  }
  return issues;
}

/** Bağımlı kaynakların kontrol referanslarını denetler. */
export function validateControls(nl: Netlist): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(nl.elements.map((e) => [e.id, e]));
  for (const e of nl.elements) {
    if (!isDependent(e.type)) continue;
    const kind = ctrlKindOf(e.type);
    const what = kind === 'V' ? 'gerilimine' : 'akımına';
    const ref = e.params.ctrl?.ref;
    if (!ref) {
      issues.push({
        level: 'error',
        message: `${e.id} için kontrol bileşeni seçilmemiş. Sağ panelden hangi bileşenin ${what} bağlı olduğunu seçin.`,
        compIds: [e.id],
      });
      continue;
    }
    if (ref === e.id) {
      issues.push({ level: 'error', message: `${e.id} kendisini kontrol edemez. Başka bir bileşen seçin.`, compIds: [e.id] });
      continue;
    }
    const c = byId.get(ref);
    if (!c) {
      issues.push({
        level: 'error',
        message: `${e.id}, ${ref} bileşeninin ${what} bağlı ama ${ref} devrede yok. ${e.id}'in kontrolünü yeniden seçin.`,
        compIds: [e.id],
      });
      continue;
    }
    const allowed = kind === 'V' ? VOLTAGE_CTRL_TYPES : CURRENT_CTRL_TYPES;
    if (!allowed.includes(c.type)) {
      issues.push({
        level: 'error',
        message: `${PARTS[c.type].name} (${ref}) ${kind === 'V' ? 'gerilim' : 'akım'} kontrolü için seçilemez.`,
        compIds: [e.id, ref],
      });
    }
  }
  return issues;
}
