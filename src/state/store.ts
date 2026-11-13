// Devre durumu, seçim, geri al / yinele ve analiz sonuçları (Zustand).
import { create } from 'zustand';
import {
  AnalysisSettings,
  CircuitDoc,
  Component,
  CompType,
  DEFAULT_ANALYSIS,
  Measured,
  PARTS,
  Params,
  Pt,
  Wire,
  nextId,
  pinPositions,
  samePt,
} from '../core/circuit';
import { buildNetlist, Issue, Netlist } from '../core/netlist';
import type { AnalysisResult } from '../core/results';
import { runAnalysis } from '../solver/runner';
import { loadDraft, saveDraft } from '../storage/project';

interface Snapshot {
  components: Component[];
  wires: Wire[];
}

export type Selection = { kind: 'comp' | 'wire'; id: string } | null;
/** Alan seçimi / Shift+tık ile oluşan çoklu seçim */
export type Group = { comps: string[]; wires: string[] } | null;

export interface AppState {
  doc: CircuitDoc;
  past: Snapshot[];
  future: Snapshot[];
  selection: Selection;
  group: Group;
  tool: 'select' | 'wire';
  placing: { type: CompType; rot: number } | null;
  /** Devre her değiştiğinde artar; sonuçların güncel olup olmadığını belirler */
  version: number;
  results: AnalysisResult | null;
  resultsVersion: number;
  resultsNetlist: Netlist | null;
  resultsInfo: string[];
  issues: Issue[];
  running: boolean;
  /** Geçici analizde gösterilen zaman adımı (null → son adım) */
  tIndex: number | null;
  showSolution: boolean;
  showNodeLabels: boolean;
  /** Grafikte gösterilen ek bileşenler */
  plotted: string[];
  toast: string | null;

  // eylemler
  setTool: (t: AppState['tool']) => void;
  setPlacing: (p: AppState['placing']) => void;
  select: (s: Selection) => void;
  /** Çoklu seçimi ayarlar; tek bileşen kalırsa normal seçime döner */
  setGroup: (g: Group) => void;
  /** Bileşen / kablo konumlarını topluca yazar (geri alma adımı beginChange ile açılır) */
  setPositions: (comps: Record<string, Pt>, wires: Record<string, { from?: Pt; to?: Pt }>) => void;
  selectAll: () => void;
  addComponent: (type: CompType, x: number, y: number, rot?: number) => string;
  /** Sürükleme başlarken çağrılır (tek bir geri alma adımı) */
  beginChange: () => void;
  /** wireEnds: bileşenle birlikte taşınacak kablo uçları (dx, dy: bileşen merkezine göre konum) */
  moveComponent: (id: string, x: number, y: number, wireEnds: { wireId: string; end: 'from' | 'to'; dx: number; dy: number }[]) => void;
  rotateSelected: () => void;
  updateParams: (id: string, p: Partial<Params>) => void;
  renameComponent: (id: string, newId: string) => string | null;
  addWires: (segs: [Pt, Pt][]) => void;
  deleteSelection: () => void;
  undo: () => void;
  redo: () => void;
  newCircuit: () => void;
  loadDoc: (doc: CircuitDoc) => void;
  setMeta: (m: Partial<CircuitDoc['meta']>) => void;
  setAnalysis: (a: Partial<AnalysisSettings>) => void;
  setMeasured: (id: string, m: Measured) => void;
  run: () => Promise<void>;
  setTIndex: (k: number | null) => void;
  setShowSolution: (v: boolean) => void;
  setShowNodeLabels: (v: boolean) => void;
  togglePlotted: (id: string) => void;
  showToast: (msg: string) => void;
}

const emptyDoc = (): CircuitDoc => ({
  version: 1,
  meta: { tarih: new Date().toISOString().slice(0, 10) },
  components: [],
  wires: [],
  analysis: { ...DEFAULT_ANALYSIS },
  measured: {},
});

let wireSeq = 0;
const newWireId = (wires: Wire[]) => {
  const used = new Set(wires.map((w) => w.id));
  let id: string;
  do id = `w${++wireSeq}`;
  while (used.has(id));
  return id;
};

const snap = (d: CircuitDoc): Snapshot => ({ components: d.components, wires: d.wires });
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<AppState>((set, get) => {
  /** Devreyi değiştiren işlemler: geri alma adımı + sürüm artışı */
  const commit = (fn: (d: CircuitDoc) => Partial<CircuitDoc>, pushHistory = true) => {
    const s = get();
    const patch = fn(s.doc);
    set({
      doc: { ...s.doc, ...patch },
      past: pushHistory ? [...s.past.slice(-99), snap(s.doc)] : s.past,
      future: pushHistory ? [] : s.future,
      version: s.version + 1,
    });
  };

  return {
    doc: loadDraft() ?? emptyDoc(),
    past: [],
    future: [],
    selection: null,
    group: null,
    tool: 'select',
    placing: null,
    version: 1,
    results: null,
    resultsVersion: 0,
    resultsNetlist: null,
    resultsInfo: [],
    issues: [],
    running: false,
    tIndex: null,
    showSolution: false,
    showNodeLabels: true,
    plotted: [],
    toast: null,

    setTool: (tool) => set({ tool, placing: null }),
    setPlacing: (placing) => set({ placing, tool: 'select' }),
    select: (selection) => set({ selection, group: null }),
    setGroup: (g) => {
      if (!g || (g.comps.length === 0 && g.wires.length === 0)) return set({ group: null, selection: null });
      if (g.comps.length === 1 && g.wires.length === 0) return set({ group: null, selection: { kind: 'comp', id: g.comps[0] } });
      if (g.comps.length === 0 && g.wires.length === 1) return set({ group: null, selection: { kind: 'wire', id: g.wires[0] } });
      set({ group: g, selection: null });
    },
    setPositions: (cp, wp) =>
      commit(
        (d) => ({
          components: d.components.map((c) => (cp[c.id] ? { ...c, x: cp[c.id][0], y: cp[c.id][1] } : c)),
          wires: d.wires.map((w) => (wp[w.id] ? { ...w, from: wp[w.id].from ?? w.from, to: wp[w.id].to ?? w.to } : w)),
        }),
        false,
      ),
    selectAll: () => {
      const d = get().doc;
      get().setGroup({ comps: d.components.map((c) => c.id), wires: d.wires.map((w) => w.id) });
    },

    addComponent: (type, x, y, rot) => {
      const id = nextId(type, get().doc.components);
      const def = PARTS[type];
      commit((d) => ({
        components: [
          ...d.components,
          { id, type, x, y, rot: rot ?? def.defaultRot, params: { ...def.defaultParams } },
        ],
      }));
      set({ selection: { kind: 'comp', id } });
      return id;
    },

    beginChange: () => {
      const s = get();
      set({ past: [...s.past.slice(-99), snap(s.doc)], future: [] });
    },

    moveComponent: (id, x, y, wireEnds) => {
      commit(
        (d) => ({
          components: d.components.map((c) => (c.id === id ? { ...c, x, y } : c)),
          wires: wireEnds.length
            ? d.wires.map((w) => {
                const ends = wireEnds.filter((e) => e.wireId === w.id);
                if (!ends.length) return w;
                const nw = { ...w };
                for (const e of ends) nw[e.end] = [x + e.dx, y + e.dy];
                return nw;
              })
            : d.wires,
        }),
        false,
      );
    },

    rotateSelected: () => {
      const { selection, placing } = get();
      if (placing) {
        set({ placing: { ...placing, rot: (placing.rot + 90) % 360 } });
        return;
      }
      if (selection?.kind !== 'comp') return;
      commit((d) => {
        const c = d.components.find((cc) => cc.id === selection.id);
        if (!c) return {};
        const oldPins = pinPositions(c);
        const rotated = { ...c, rot: (c.rot + 90) % 360 };
        const newPins = pinPositions(rotated);
        // pinlere bağlı kablo uçlarını birlikte taşı
        const wires = d.wires.map((w) => {
          let nw = w;
          oldPins.forEach((p, i) => {
            if (samePt(w.from, p)) nw = { ...nw, from: newPins[i] };
            if (samePt(w.to, p)) nw = { ...nw, to: newPins[i] };
          });
          return nw;
        });
        return { components: d.components.map((cc) => (cc.id === c.id ? rotated : cc)), wires };
      });
    },

    updateParams: (id, p) =>
      commit((d) => ({
        components: d.components.map((c) => (c.id === id ? { ...c, params: { ...c.params, ...p } } : c)),
      })),

    renameComponent: (id, newIdRaw) => {
      const newId = newIdRaw.trim();
      if (!newId || newId === id) return null;
      if (!/^[A-Za-z][A-Za-z0-9]{0,15}$/.test(newId)) return 'İsim harfle başlamalı; en fazla 16 harf ve rakam içerebilir.';
      if (get().doc.components.some((c) => c.id === newId)) return 'Bu isim zaten kullanılıyor.';
      commit((d) => {
        const measured = { ...d.measured };
        if (measured[id]) {
          measured[newId] = measured[id];
          delete measured[id];
        }
        return { components: d.components.map((c) => (c.id === id ? { ...c, id: newId } : c)), measured };
      });
      set({ selection: { kind: 'comp', id: newId } });
      return null;
    },

    addWires: (segs) => {
      const valid = segs.filter(([a, b]) => !samePt(a, b));
      if (!valid.length) return;
      commit((d) => {
        const wires = [...d.wires];
        for (const [a, b] of valid) {
          // aynı kablo zaten varsa ekleme
          if (wires.some((w) => (samePt(w.from, a) && samePt(w.to, b)) || (samePt(w.from, b) && samePt(w.to, a)))) continue;
          wires.push({ id: newWireId(wires), from: a, to: b });
        }
        return { wires };
      });
    },

    deleteSelection: () => {
      const { selection: sel, group } = get();
      if (group) {
        const cs = new Set(group.comps);
        const ws = new Set(group.wires);
        commit((d) => ({ components: d.components.filter((c) => !cs.has(c.id)), wires: d.wires.filter((w) => !ws.has(w.id)) }));
        set({ group: null, selection: null });
        return;
      }
      if (!sel) return;
      commit((d) =>
        sel.kind === 'comp'
          ? { components: d.components.filter((c) => c.id !== sel.id) }
          : { wires: d.wires.filter((w) => w.id !== sel.id) },
      );
      set({ selection: null });
    },

    undo: () => {
      const s = get();
      const prev = s.past[s.past.length - 1];
      if (!prev) return;
      set({
        doc: { ...s.doc, ...prev },
        past: s.past.slice(0, -1),
        future: [snap(s.doc), ...s.future],
        version: s.version + 1,
        selection: null,
        group: null,
      });
    },
    redo: () => {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      set({
        doc: { ...s.doc, ...next },
        past: [...s.past, snap(s.doc)],
        future: s.future.slice(1),
        version: s.version + 1,
        selection: null,
        group: null,
      });
    },

    newCircuit: () => {
      const s = get();
      set({
        doc: emptyDoc(),
        past: [...s.past, snap(s.doc)],
        future: [],
        version: s.version + 1,
        selection: null,
        group: null,
        results: null,
        issues: [],
        plotted: [],
      });
    },

    loadDoc: (doc) =>
      set((s) => ({
        doc,
        past: [],
        future: [],
        version: s.version + 1,
        selection: null,
        group: null,
        results: null,
        issues: [],
        tIndex: null,
        plotted: [],
      })),

    setMeta: (m) => set((s) => ({ doc: { ...s.doc, meta: { ...s.doc.meta, ...m } } })),

    setAnalysis: (a) => set((s) => ({ doc: { ...s.doc, analysis: { ...s.doc.analysis, ...a } }, version: s.version + 1 })),

    setMeasured: (id, m) =>
      set((s) => {
        const measured = { ...s.doc.measured };
        const cur = { ...(measured[id] ?? {}), ...m };
        if (cur.V === undefined) delete cur.V;
        if (cur.I === undefined) delete cur.I;
        if (cur.V === undefined && cur.I === undefined) delete measured[id];
        else measured[id] = cur;
        return { doc: { ...s.doc, measured } };
      }),

    run: async () => {
      const s = get();
      const version = s.version;
      const nl = buildNetlist(s.doc.components, s.doc.wires);
      set({ running: true });
      try {
        const out = await runAnalysis(nl, s.doc.analysis);
        if (!out.ok) {
          set({ issues: out.issues, running: false, results: null, resultsInfo: out.info });
          return;
        }
        set({
          results: out.result!,
          resultsVersion: version,
          resultsNetlist: nl,
          resultsInfo: out.info,
          issues: out.issues,
          running: false,
          tIndex: null,
        });
      } catch (e) {
        set({
          running: false,
          issues: [{ level: 'error', message: `Analiz hatası: ${(e as Error).message}`, compIds: [] }],
        });
      }
    },

    setTIndex: (tIndex) => set({ tIndex }),
    setShowSolution: (showSolution) => set({ showSolution }),
    setShowNodeLabels: (showNodeLabels) => set({ showNodeLabels }),
    togglePlotted: (id) =>
      set((s) => ({ plotted: s.plotted.includes(id) ? s.plotted.filter((p) => p !== id) : [...s.plotted, id] })),
    showToast: (msg) => {
      clearTimeout(toastTimer);
      set({ toast: msg });
      toastTimer = setTimeout(() => set({ toast: null }), 3200);
    },
  };
});

// Her değişiklikte taslağı tarayıcıya yaz (kısa gecikmeyle).
let draftTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.doc === prev.doc) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveDraft(useStore.getState().doc), 400);
});

export const isStale = (s: Pick<AppState, 'version' | 'resultsVersion' | 'results'>) =>
  !!s.results && s.version !== s.resultsVersion;
