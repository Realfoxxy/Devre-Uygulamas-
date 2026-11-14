// PDF rapor: başlık bloğu, vektör devre şeması, analiz ayarları, sonuç ve düğüm tabloları,
// grafikler ve isteğe bağlı MNA eki. Tamamen tarayıcıda oluşturulur.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import 'svg2pdf.js';
import type { AnalysisSettings, Component, Measured, Wire } from '../core/circuit';
import { PARTS } from '../core/circuit';
import { describeValue, Netlist, netlistText } from '../core/netlist';
import type { AnalysisResult } from '../core/results';
import { formatEng, percentError } from '../core/units';
import type { ReportHeader } from '../storage/project';
import { bodeConfigs, renderChartPNG, transientConfigs } from '../ui/chartConfig';
import { fmtCell } from '../ui/SolutionView';
import { compDisplay, nodeText, stepIndex } from '../ui/values';
import { schematicSvg, svgToPngDataUrl } from './schematicSvg';
export { schematicSvg, svgToPngDataUrl };
import type { MethodResult } from '../solver/methods/nodal';

const FONT = 'DejaVuSans';
let fontCache: { normal: string; bold: string } | null = null;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

async function loadFonts() {
  if (fontCache) return fontCache;
  const base = import.meta.env.BASE_URL ?? './';
  const [n, b] = await Promise.all(
    ['fonts/DejaVuSans.ttf', 'fonts/DejaVuSans-Bold.ttf'].map(async (p) => {
      const r = await fetch(`${base}${p}`);
      if (!r.ok) throw new Error(`Yazı tipi yüklenemedi: ${p}`);
      return toBase64(await r.arrayBuffer());
    }),
  );
  fontCache = { normal: n, bold: b };
  return fontCache;
}

export async function newPdf(orientation: 'portrait' | 'landscape' = 'portrait') {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation, compress: true });
  const f = await loadFonts();
  doc.addFileToVFS('DejaVuSans.ttf', f.normal);
  doc.addFont('DejaVuSans.ttf', FONT, 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', f.bold);
  doc.addFont('DejaVuSans-Bold.ttf', FONT, 'bold');
  doc.setFont(FONT, 'normal');
  return doc;
}

/** SVG şemayı PDF'e vektör olarak yerleştirir; yüksekliği (mm) döndürür. */
export async function placeSchematic(
  doc: jsPDF,
  svg: { markup: string; width: number; height: number },
  x: number,
  y: number,
  maxW: number,
  maxH: number,
  maxScale = Infinity,
): Promise<number> {
  const scale = Math.min(maxW / svg.width, maxH / svg.height, maxScale);
  const w = svg.width * scale;
  const h = svg.height * scale;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;';
  holder.innerHTML = svg.markup;
  document.body.appendChild(holder);
  const el = holder.querySelector('svg')!;
  try {
    await doc.svg(el, { x: x + (maxW - w) / 2, y, width: w, height: h });
  } finally {
    holder.remove();
  }
  return h;
}

export interface ReportInput {
  header: ReportHeader;
  components: Component[];
  wires: Wire[];
  analysis: AnalysisSettings;
  measured: Record<string, Measured>;
  results: AnalysisResult;
  netlist: Netlist;
  tIndex: number | null;
  plotIds: string[];
  includeSolution: boolean;
  info: string[];
  /** İsteğe bağlı araç bölümleri (yalnızca kullanıldıysa) */
  sections?: ReportSections;
}

export interface ReportSections {
  nodeEquations?: MethodResult & { supernodes?: number[][] };
  meshEquations?: MethodResult;
  thevenin?: { a: number; b: number; Vth: string; IN: string; Rth: string; notes: string[]; maxPower?: string };
  superposition?: { target: string; head: string[]; rows: string[][]; note: string };
  dynamics?: boolean;
}

const M = 14; // kenar boşluğu (mm)
/** Grafik görüntüsü yüksekliği (piksel, genişlik 1100) */
const CH_PX = 600;

type RGB = [number, number, number];
const INK: RGB = [29, 36, 51];
const MUTED: RGB = [107, 114, 128];

export async function buildReport(r: ReportInput): Promise<jsPDF> {
  const doc = await newPdf();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CW = W - 2 * M;
  const BOTTOM = H - 12;
  let y = M;

  /** Gerekli yükseklik sığmıyorsa yeni sayfa */
  const ensure = (need: number) => {
    if (y + need > BOTTOM) {
      doc.addPage();
      y = M;
    }
  };
  const heading = (t: string, keepWith = 18) => {
    ensure(8 + keepWith);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(t, M, y + 4);
    doc.setDrawColor(37, 87, 214);
    doc.setLineWidth(0.4);
    doc.line(M, y + 5.6, M + 14, y + 5.6);
    y += 8.5;
    doc.setFont(FONT, 'normal');
  };
  /** Satır sarmalı küçük metin */
  const para = (text: string, size = 8.2, color: RGB = MUTED, mono = false) => {
    doc.setFont(FONT, mono ? 'normal' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, CW) as string[];
    const lh = size * 0.42;
    ensure(lines.length * lh + 1);
    doc.text(lines, M, y + lh * 0.8);
    y += lines.length * lh + 1.2;
  };
  const table = {
    styles: { font: FONT, fontSize: 8.2, cellPadding: 1.3, textColor: INK, lineColor: [222, 226, 233] as RGB, lineWidth: 0.2 },
    headStyles: { fillColor: [238, 241, 247] as RGB, textColor: INK, fontStyle: 'bold' as const },
    margin: { left: M, right: M, bottom: 14 },
    theme: 'grid' as const,
  };
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  /** Küçük tablolar bölünmesin: sığmıyorsa bütün olarak sonraki sayfaya */
  const smallTable = (rows: number) => (rows <= 22 ? ('avoid' as const) : ('auto' as const));

  // 1) Başlık bloğu
  doc.setFillColor(37, 87, 214);
  doc.rect(0, 0, W, 2.5, 'F');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('Devre Lab Simülatörü — Deney Raporu', M, y + 1.5);
  doc.text(r.header.tarih || '', W - M, y + 1.5, { align: 'right' });
  y += 5;
  doc.setFont(FONT, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  const title = doc.splitTextToSize(r.header.deney || 'Devre Deneyi', CW) as string[];
  doc.text(title, M, y + 5);
  y += 3 + title.length * 6.5;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  const who = [
    r.header.ogrenci && `Öğrenci: ${r.header.ogrenci}`,
    r.header.numara && `No: ${r.header.numara}`,
    r.header.ders && `Ders: ${r.header.ders}`,
  ]
    .filter(Boolean)
    .join('   ·   ');
  if (who) {
    doc.text(who, M, y + 3);
    y += 6;
  }
  y += 1;

  // 2) Devre şeması
  heading('Devre şeması', 40);
  const svg = schematicSvg({
    components: r.components,
    wires: r.wires,
    results: r.results,
    netlist: r.netlist,
    tIndex: r.tIndex,
    acMeasure: r.analysis.acMeasure,
  });
  // şema okunaklı ama gereğinden büyük olmasın: en fazla 0.27 mm/piksel ve 64 mm yükseklik
  const maxH = 64;
  const SCALE = 0.27;
  const est = Math.min(maxH, svg.height * Math.min(SCALE, CW / svg.width));
  ensure(est + 6);
  const sh = await placeSchematic(doc, svg, M, y, CW, maxH, SCALE);
  y += sh + 1;
  para('Etiketler: düğüm numarası ve gerilimi (toprak = 0). Pasif elemanlarda “+” pozitif ucu gösterir.', 7.4);
  y += 1;

  // 3) Analiz ayarları (solda) ve düğüm gerilimleri (sağda) yan yana
  const a = r.analysis;
  const res = r.results;
  const isAC = res.kind === 'ac';
  const settingsRows: string[][] = [];
  if (res.kind === 'dc') settingsRows.push(['Analiz', 'DC (C açık, L kısa devre)']);
  if (res.kind === 'ac') {
    settingsRows.push(['Analiz', 'AC fazör (kararlı durum)']);
    settingsRows.push(['Frekans', `${formatEng(res.freq, 'Hz')} (ω = ${parseFloat((2 * Math.PI * res.freq).toPrecision(5))} rad/s)`]);
    if (res.sweep) settingsRows.push(['Tarama', `${formatEng(res.sweep.f[0], 'Hz')} – ${formatEng(res.sweep.f[res.sweep.f.length - 1], 'Hz')}, ${res.sweep.f.length} nokta`]);
    settingsRows.push(['Fazör', `tepe değer; ölçüm ${a.acMeasure === 'rms' ? 'etkin (RMS)' : 'tepe'} ile karşılaştırıldı`]);
  }
  if (res.kind === 'transient') {
    settingsRows.push(['Analiz', `Geçici rejim, ${res.method === 'trap' ? 'trapez (ilk adım geri Euler)' : 'geri Euler'}`]);
    settingsRows.push(['Süre / adım', `${formatEng(res.tStop, 's')} / h = ${formatEng(res.h, 's')} (${res.t.length - 1} adım)`]);
    const taus = Object.entries(res.tau);
    if (taus.length && !res.secondOrder) settingsRows.push(['τ', taus.map(([id, t]) => `${id}: ${formatEng(t, 's')}`).join(', ')]);
    settingsRows.push(['Tablodaki an', `t = ${formatEng(res.t[stepIndex(res, r.tIndex)], 's')}`]);
  }
  for (const i of r.info.filter((x) => !/otomatik/.test(x)).slice(0, 4)) settingsRows.push(['Not', i]);
  const nodeRows = [['0', '0 V']];
  for (let k = 1; k <= r.netlist.nodeCount; k++) nodeRows.push([String(k), nodeText(res, k, r.tIndex)]);
  const leftW = CW * 0.62;
  const rightW = CW - leftW - 4;
  const blockH = Math.max(settingsRows.length, nodeRows.length + 1) * 5.2 + 12;
  heading('Analiz ayarları ve düğüm gerilimleri', Math.min(blockH, 60));
  const y0 = y;
  autoTable(doc, {
    ...table,
    startY: y0,
    body: settingsRows,
    tableWidth: leftW,
    margin: { left: M, right: W - M - leftW, bottom: 14 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 24 } },
    pageBreak: 'avoid',
  });
  const yL = lastY();
  const pageL = doc.getNumberOfPages();
  doc.setPage(pageL);
  autoTable(doc, {
    ...table,
    startY: pageL === doc.getNumberOfPages() && yL >= y0 ? y0 : M,
    head: [['Düğüm', isAC ? 'Gerilim (tepe)' : 'Gerilim']],
    body: nodeRows,
    tableWidth: rightW,
    margin: { left: M + leftW + 4, right: M, bottom: 14 },
    pageBreak: 'avoid',
  });
  const pageR = doc.getNumberOfPages();
  y = (pageR > pageL ? lastY() : Math.max(yL, lastY())) + 5;

  // 4) Sonuç tablosu
  const comps = r.components.filter((c) => c.type !== 'GND');
  const anyMeasured = comps.some((c) => r.measured[c.id]);
  const head = ['Ad', 'Değer', isAC ? 'Gerilim (tepe)' : 'Gerilim', isAC ? 'Akım (tepe)' : 'Akım', isAC ? 'Ort. güç' : 'Güç'];
  if (anyMeasured) head.push('Ölçülen V', 'Hata V', 'Ölçülen I', 'Hata I');
  const body = comps.map((c) => {
    const d = compDisplay(res, c.id, c.type, r.tIndex, a.acMeasure, c.params);
    const find = (p: string) => d?.rows.find((x) => x.label.startsWith(p));
    const V = (c.type === 'OA' ? find('Çıkış gerilimi') : find('Gerilim'))?.value ?? '—';
    const I = (c.type === 'OA' ? find('Çıkış akımı') : find('Akım'))?.value ?? '—';
    const Pr = find(isAC ? 'Ortalama' : res.kind === 'transient' ? 'Anlık' : 'Güç');
    const P = Pr ? `${Pr.value}${Pr.hint ? ' ' + Pr.hint : ''}` : '—';
    const row = [c.id, describeValue(c.type, c.params) || PARTS[c.type].name, V, I, P];
    if (anyMeasured) {
      const m = r.measured[c.id] ?? {};
      const eV = m.V !== undefined && d?.cmpV != null ? percentError(m.V, d.cmpV) : null;
      const eI = m.I !== undefined && d?.cmpI != null ? percentError(m.I, d.cmpI) : null;
      row.push(m.V !== undefined ? formatEng(m.V, 'V') : '', eV !== null ? `%${eV.toFixed(2)}` : '', m.I !== undefined ? formatEng(m.I, 'A') : '', eI !== null ? `%${eI.toFixed(2)}` : '');
    }
    return row;
  });
  heading('Sonuç tablosu', Math.min(body.length * 5.2 + 8, 50));
  autoTable(doc, {
    ...table,
    startY: y,
    head: [head],
    body,
    styles: { ...table.styles, fontSize: anyMeasured ? 7.3 : 8.2 },
    columnStyles: { 0: { fontStyle: 'bold' } },
    pageBreak: smallTable(body.length),
  });
  y = lastY() + 1.5;
  para(
    'Pasif işaret kuralı: akım bileşenin + ucundan girerse pozitif; güç veren elemanın gücü negatif.' +
      (anyMeasured ? ' % hata = |ölçülen − hesaplanan| / |hesaplanan| × 100.' : ''),
    7.4,
  );
  y += 2;

  // 5) Araç bölümleri: yalnızca kullanıldıysa
  const sec = r.sections ?? {};
  const eqBlock = (title: string, m: MethodResult) => {
    heading(title, 20);
    if (m.given.length) para(`Doğrudan bilinenler: ${m.given.join(', ')}`, 8, INK);
    if (m.defs.length) para(`Kontrol büyüklükleri: ${m.defs.join(', ')}`, 8, INK);
    autoTable(doc, {
      ...table,
      startY: y,
      body: m.equations.map((e) => [e.title, e.text, e.simplified === e.text ? '' : e.simplified]),
      head: [['Denklem', 'Öğrenci biçimi', 'Sadeleşmiş']],
      styles: { ...table.styles, fontSize: 7.6 },
      columnStyles: { 0: { cellWidth: 38, fontStyle: 'bold' } },
      pageBreak: smallTable(m.equations.length),
    });
    y = lastY() + 1.5;
    if (m.solution) para(`Çözüm: ${m.unknowns.map((u, i) => `${u} = ${parseFloat(m.solution![i].toPrecision(5))}`).join(', ')}`, 8, INK);
    y += 2;
  };
  if (sec.nodeEquations?.ok) eqBlock('Düğüm denklemleri', sec.nodeEquations);
  if (sec.meshEquations?.ok) eqBlock('Çevre denklemleri', sec.meshEquations);
  if (sec.thevenin) {
    const t = sec.thevenin;
    heading(`Thevenin ve Norton eşdeğeri (a = ${t.a}, b = ${t.b})`, 22);
    autoTable(doc, {
      ...table,
      startY: y,
      body: [['V_th (açık devre)', t.Vth], ['I_N (kısa devre)', t.IN], ['R_th (test kaynağıyla)', t.Rth], ...(t.maxPower ? [['Maksimum güç', t.maxPower]] : [])],
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } },
      tableWidth: CW * 0.7,
      pageBreak: 'avoid',
    });
    y = lastY() + 1.5;
    for (const n of t.notes) para(n, 7.6);
    y += 2;
  }
  if (sec.superposition) {
    const sp = sec.superposition;
    heading(`Süperpozisyon (${sp.target})`, 22);
    autoTable(doc, { ...table, startY: y, head: [sp.head], body: sp.rows, pageBreak: 'avoid' });
    y = lastY() + 1.5;
    para(sp.note, 7.6);
    y += 2;
  }
  if (sec.dynamics !== false && res.kind === 'transient' && res.firstOrder?.applicable) {
    const fo = res.firstOrder;
    heading('Birinci derece tam yanıt', 22);
    const rows = fo.intervals.map((iv) => [
      `${formatEng(iv.t0, 's')} – ${formatEng(iv.t1, 's')}`,
      iv.tauText || '—',
      iv.formula ?? iv.note ?? '—',
    ]);
    autoTable(doc, { ...table, startY: y, head: [['Aralık', 'τ', `${fo.symbol}(t)`]], body: rows, styles: { ...table.styles, fontSize: 7.4 }, columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 52 } }, pageBreak: smallTable(rows.length) });
    y = lastY() + 3;
  }
  if (sec.dynamics !== false && res.kind === 'transient' && res.secondOrder?.analysis.ok) {
    const so = res.secondOrder.analysis;
    heading(`${so.order}. derece devre: karakteristik denklem`, 40);
    const rowsSO: string[][] = [
      ['Durum değişkenleri', so.states.map((x) => x.name).join(', ')],
      ...so.stateEquations.map((e, i) => [i === 0 ? 'Durum denklemleri' : '', e]),
      ['Karakteristik denklem', so.polyText],
    ];
    if (so.alpha !== undefined) rowsSO.push(['α, ω₀', `α = ${parseFloat(so.alpha.toPrecision(5))} 1/s, ω₀ = ${parseFloat(so.omega0!.toPrecision(5))} rad/s`]);
    rowsSO.push(['Doğal yanıt', so.dampingText]);
    if (res.secondOrder.response) rowsSO.push(['Tam yanıt', res.secondOrder.response.formula]);
    for (const d of so.dependent) rowsSO.push(['Not', d.reason]);
    // s-düzlemi küçük çizim sağda
    const plotW = 42;
    const pageBefore = doc.getNumberOfPages();
    autoTable(doc, { ...table, startY: y, body: rowsSO, tableWidth: CW - plotW - 4, margin: { left: M, right: M + plotW + 4, bottom: 14 }, styles: { ...table.styles, fontSize: 7.4 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 30 } }, pageBreak: 'avoid' });
    const yEnd = lastY();
    const top = doc.getNumberOfPages() > pageBefore ? Math.max(M, yEnd - plotW) : y;
    drawSPlane(doc, so.roots, so.omega0, M + CW - plotW, top, plotW);
    y = Math.max(yEnd, top + plotW) + 4;
  }

  // 6) Grafikler: iki grafik yan yana
  const plotIds = r.plotIds.filter((id) => 'comps' in res && id in res.comps);
  let charts: { title: string; url: string }[] = [];
  if (plotIds.length && res.kind === 'transient') {
    const { v, i } = transientConfigs(res, plotIds, true);
    charts = [
      { title: `v(t): ${plotIds.join(', ')}`, url: renderChartPNG(v, 1100, CH_PX) },
      { title: `i(t): ${plotIds.join(', ')}`, url: renderChartPNG(i, 1100, CH_PX) },
    ];
  } else if (plotIds.length && res.kind === 'ac' && res.sweep) {
    const { mag, ph } = bodeConfigs(res, plotIds, true);
    charts = [
      { title: `Bode genlik: ${plotIds.join(', ')}`, url: renderChartPNG(mag, 1100, CH_PX) },
      { title: `Bode faz: ${plotIds.join(', ')}`, url: renderChartPNG(ph, 1100, CH_PX) },
    ];
  }
  if (charts.length) {
    const cw = (CW - 4) / 2;
    const ch = (cw * CH_PX) / 1100;
    heading('Grafikler', ch + 6);
    ensure(ch + 6);
    charts.forEach((c, k) => {
      const x = M + k * (cw + 4);
      doc.setFontSize(8);
      doc.setTextColor(...INK);
      doc.text(c.title, x, y + 2.5);
      doc.addImage(c.url, 'PNG', x, y + 4, cw, ch, undefined, 'FAST');
    });
    y += ch + 7;
  }

  // 7) Ek: netlist ve MNA matrisi (yeni sayfaya zorlanmaz)
  if (r.includeSolution) {
    const lines = netlistText(r.netlist).split('\n').filter(Boolean);
    heading('Ek — netlist', Math.min(lines.length * 5 + 8, 40));
    autoTable(doc, {
      ...table,
      startY: y,
      head: [['Eleman', 'Düğümler', 'Değer']],
      body: lines.map((l, idx) => {
        const t = l.trim().split(/\s+/);
        const nLen = r.netlist.elements[idx]?.nodes.length ?? 2;
        const nodes = t.slice(1, 1 + nLen);
        return [t[0], nodes.join(', '), t.slice(1 + nLen).join(' ')];
      }),
      styles: { ...table.styles, fontSize: 7.4 },
      pageBreak: smallTable(lines.length),
    });
    y = lastY() + 3;
    const sys = res.system;
    const N = sys.labels.length;
    heading('Ek — MNA matrisi  A · x = b', Math.min(N * 5 + 12, 70));
    para(sys.note, 7.4);
    const fs = N > 10 ? 5.6 : N > 6 ? 6.6 : 7.6;
    autoTable(doc, {
      ...table,
      startY: y,
      head: [['', ...sys.labels, 'b', 'x']],
      body: sys.A.map((row, i) => [sys.labels[i], ...row.map(fmtCell), fmtCell(sys.b[i]), fmtCell(sys.x[i])]),
      styles: { ...table.styles, fontSize: fs, halign: 'center', cellPadding: 0.8 },
      columnStyles: { 0: { fontStyle: 'bold' } },
      pageBreak: smallTable(N),
    });
    y = lastY() + 3;
  }

  // Sayfa numaraları
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(150, 155, 165);
    doc.text(`${r.header.deney || 'Devre Deneyi'}${r.header.ogrenci ? ` · ${r.header.ogrenci}` : ''}`, M, H - 6);
    doc.text(`Sayfa ${p} / ${pages}`, W - M, H - 6, { align: 'right' });
  }
  return doc;
}

/** s-düzlemi: eksenler, ω₀ yarım çemberi ve kökler (×) */
function drawSPlane(doc: jsPDF, roots: { re: number; im: number }[], w0: number | undefined, x: number, y: number, size: number) {
  const R = Math.max(1e-12, w0 ?? 0, ...roots.map((r) => Math.hypot(r.re, r.im))) * 1.25;
  const c = size / 2;
  const k = (size / 2 - 3) / R;
  doc.setDrawColor(200, 206, 217);
  doc.setLineWidth(0.25);
  doc.rect(x, y, size, size);
  doc.line(x + 2, y + c, x + size - 2, y + c);
  doc.line(x + c, y + 2, x + c, y + size - 2);
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text('σ', x + size - 4, y + c - 1);
  doc.text('jω', x + c + 1, y + 4);
  doc.text('s-düzlemi', x + 1.5, y + size - 1.5);
  if (w0) {
    doc.setDrawColor(124, 58, 237);
    const pts = 40;
    for (let i = 0; i < pts; i++) {
      const a1 = Math.PI / 2 + (Math.PI * i) / pts;
      const a2 = Math.PI / 2 + (Math.PI * (i + 1)) / pts;
      doc.line(x + c + w0 * k * Math.cos(a1), y + c - w0 * k * Math.sin(a1), x + c + w0 * k * Math.cos(a2), y + c - w0 * k * Math.sin(a2));
    }
  }
  doc.setDrawColor(217, 45, 32);
  doc.setLineWidth(0.6);
  for (const r of roots) {
    const px = x + c + r.re * k;
    const py = y + c - r.im * k;
    doc.line(px - 1.5, py - 1.5, px + 1.5, py + 1.5);
    doc.line(px + 1.5, py - 1.5, px - 1.5, py + 1.5);
  }
}

/** "Sadece şemayı dışa aktar" — tek sayfalık PDF. */
export async function buildSchematicPdf(svg: { markup: string; width: number; height: number }, title: string) {
  const landscape = svg.width > svg.height;
  const doc = await newPdf(landscape ? 'landscape' : 'portrait');
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  doc.setFont(FONT, 'bold');
  doc.setFontSize(13);
  doc.text(title || 'Devre şeması', M, M);
  await placeSchematic(doc, svg, M, M + 6, W - 2 * M, H - 2 * M - 8);
  return doc;
}
