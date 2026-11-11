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
import { schematicSvg } from './schematicSvg';

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
): Promise<number> {
  const scale = Math.min(maxW / svg.width, maxH / svg.height);
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
}

const M = 16; // kenar boşluğu (mm)

export async function buildReport(r: ReportInput): Promise<jsPDF> {
  const doc = await newPdf();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CW = W - 2 * M;
  let y = M;

  const ensure = (need: number) => {
    if (y + need > H - M) {
      doc.addPage();
      y = M;
    }
  };
  const heading = (t: string) => {
    ensure(14);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(12.5);
    doc.setTextColor(29, 36, 51);
    doc.text(t, M, y + 5);
    doc.setDrawColor(37, 87, 214);
    doc.setLineWidth(0.5);
    doc.line(M, y + 7, M + 18, y + 7);
    y += 11;
    doc.setFont(FONT, 'normal');
    doc.setFontSize(10);
  };
  const tableDefaults = {
    styles: { font: FONT, fontSize: 8.6, cellPadding: 1.6, textColor: [29, 36, 51] as [number, number, number], lineColor: [222, 226, 233] as [number, number, number], lineWidth: 0.2 },
    headStyles: { fillColor: [238, 241, 247] as [number, number, number], textColor: [29, 36, 51] as [number, number, number], fontStyle: 'bold' as const },
    margin: { left: M, right: M },
    theme: 'grid' as const,
  };
  const after = () => ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? y) + 6;

  // 1) Başlık bloğu
  doc.setFillColor(37, 87, 214);
  doc.rect(0, 0, W, 3, 'F');
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text('Devre Lab Simülatörü — Deney Raporu', M, y + 2);
  y += 9;
  doc.setFont(FONT, 'bold');
  doc.setFontSize(18);
  doc.setTextColor(29, 36, 51);
  const title = doc.splitTextToSize(r.header.deney || 'Devre Deneyi', CW);
  doc.text(title, M, y + 4);
  y += 6 + title.length * 7;
  autoTable(doc, {
    ...tableDefaults,
    startY: y,
    theme: 'plain',
    styles: { ...tableDefaults.styles, fontSize: 9.5, cellPadding: 1.2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 32 }, 2: { fontStyle: 'bold', cellWidth: 28 } },
    body: [
      ['Öğrenci', r.header.ogrenci || '—', 'Ders kodu', r.header.ders || '—'],
      ['Numara', r.header.numara || '—', 'Tarih', r.header.tarih || '—'],
    ],
  });
  y = after();

  // 2) Devre şeması
  heading('Devre şeması');
  const svg = schematicSvg({
    components: r.components,
    wires: r.wires,
    results: r.results,
    netlist: r.netlist,
    tIndex: r.tIndex,
    acMeasure: r.analysis.acMeasure,
  });
  const maxH = 105;
  const est = Math.min(maxH, (svg.height * CW) / svg.width);
  ensure(est + 4);
  const sh = await placeSchematic(doc, svg, M, y, CW, maxH);
  y += sh + 3;
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.text('Etiketler: düğüm numarası ve düğüm gerilimi (toprak = 0). Pasif elemanlarda “+” işareti pozitif ucu gösterir.', M, y + 2);
  y += 8;

  // 3) Analiz ayarları
  heading('Analiz ayarları');
  const a = r.analysis;
  const res = r.results;
  const settingsRows: string[][] = [];
  if (res.kind === 'dc') settingsRows.push(['Analiz türü', 'DC (kapasitörler açık, bobinler kısa devre)']);
  if (res.kind === 'ac') {
    settingsRows.push(['Analiz türü', 'AC fazör analizi (kararlı durum)']);
    settingsRows.push(['Frekans', `${formatEng(res.freq, 'Hz')}  (ω = ${parseFloat((2 * Math.PI * res.freq).toPrecision(5))} rad/s)`]);
    if (res.sweep) settingsRows.push(['Frekans taraması', `${formatEng(res.sweep.f[0], 'Hz')} – ${formatEng(res.sweep.f[res.sweep.f.length - 1], 'Hz')}, ${res.sweep.f.length} nokta (logaritmik)`]);
    settingsRows.push(['Fazör genliği', 'Tepe değer; ölçülen değerler ' + (a.acMeasure === 'rms' ? 'etkin (RMS)' : 'tepe') + ' değerle karşılaştırıldı']);
  }
  if (res.kind === 'transient') {
    settingsRows.push(['Analiz türü', 'Geçici rejim (companion model)']);
    settingsRows.push(['Yöntem', res.method === 'trap' ? 'Trapez (ilk adım geri Euler)' : 'Geri Euler']);
    settingsRows.push(['Toplam süre', formatEng(res.tStop, 's')]);
    settingsRows.push(['Zaman adımı h', `${formatEng(res.h, 's')} (${res.t.length - 1} adım)`]);
    const taus = Object.entries(res.tau);
    if (taus.length) settingsRows.push(['Zaman sabitleri', taus.map(([id, t]) => `τ(${id}) = ${formatEng(t, 's')}`).join(', ')]);
    settingsRows.push(['Tablodaki değerler', `t = ${formatEng(res.t[stepIndex(res, r.tIndex)], 's')} anında`]);
  }
  for (const i of r.info) settingsRows.push(['Not', i]);
  autoTable(doc, { ...tableDefaults, startY: y, body: settingsRows, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } } });
  y = after();

  // 4) Sonuç tablosu
  heading('Sonuç tablosu');
  const comps = r.components.filter((c) => c.type !== 'GND');
  const anyMeasured = comps.some((c) => r.measured[c.id]);
  const isAC = res.kind === 'ac';
  const head = ['Ad', 'Değer', isAC ? 'Gerilim (tepe)' : 'Gerilim', isAC ? 'Akım (tepe)' : 'Akım', isAC ? 'Ort. güç' : 'Güç'];
  if (anyMeasured) head.push('Ölçülen V', 'Hata V', 'Ölçülen I', 'Hata I');
  const body = comps.map((c) => {
    const d = compDisplay(res, c.id, c.type, r.tIndex, a.acMeasure);
    const find = (p: string) => d?.rows.find((x) => x.label.startsWith(p));
    const V = find('Gerilim')?.value ?? '—';
    const I = find('Akım')?.value ?? '—';
    const Pr = find(isAC ? 'Ortalama' : res.kind === 'transient' ? 'Anlık' : 'Güç');
    const P = Pr ? `${Pr.value}${Pr.hint ? ' ' + Pr.hint : ''}` : '—';
    const row = [c.id, c.type === 'VM' || c.type === 'AM' ? PARTS[c.type].name : describeValue(c.type, c.params), V, I, P];
    if (anyMeasured) {
      const m = r.measured[c.id] ?? {};
      const eV = m.V !== undefined && d?.cmpV != null ? percentError(m.V, d.cmpV) : null;
      const eI = m.I !== undefined && d?.cmpI != null ? percentError(m.I, d.cmpI) : null;
      row.push(
        m.V !== undefined ? formatEng(m.V, 'V') : '',
        eV !== null ? `%${eV.toFixed(2)}` : '',
        m.I !== undefined ? formatEng(m.I, 'A') : '',
        eI !== null ? `%${eI.toFixed(2)}` : '',
      );
    }
    return row;
  });
  autoTable(doc, {
    ...tableDefaults,
    startY: y,
    head: [head],
    body,
    styles: { ...tableDefaults.styles, fontSize: anyMeasured ? 7.6 : 8.6 },
    columnStyles: { 0: { fontStyle: 'bold' } },
  });
  y = after();
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  const note = doc.splitTextToSize(
    'İşaret kuralı: pasif işaret kuralı — akım bileşenin + ucundan girerse pozitiftir. Kaynak güç veriyorsa güç negatif çıkar. ' +
      (anyMeasured ? '% hata = |ölçülen − hesaplanan| / |hesaplanan| × 100.' : ''),
    CW,
  );
  ensure(note.length * 4);
  doc.text(note, M, y - 2);
  y += note.length * 3.6 + 2;

  // 5) Düğüm gerilimleri
  heading('Düğüm gerilimleri');
  const nodeRows = [['0 (toprak)', '0 V']];
  for (let k = 1; k <= r.netlist.nodeCount; k++) nodeRows.push([String(k), nodeText(res, k, r.tIndex)]);
  autoTable(doc, {
    ...tableDefaults,
    startY: y,
    head: [['Düğüm', isAC ? 'Gerilim (fazör, tepe)' : 'Gerilim']],
    body: nodeRows,
    tableWidth: 90,
  });
  y = after();

  // 6) Grafikler
  const plotIds = r.plotIds.filter((id) => 'comps' in res && id in res.comps);
  let charts: { title: string; url: string }[] = [];
  if (plotIds.length && res.kind === 'transient') {
    const { v, i } = transientConfigs(res, plotIds, true);
    charts = [
      { title: `Gerilim v(t): ${plotIds.join(', ')}`, url: renderChartPNG(v) },
      { title: `Akım i(t): ${plotIds.join(', ')}`, url: renderChartPNG(i) },
    ];
  } else if (plotIds.length && res.kind === 'ac' && res.sweep) {
    const { mag, ph } = bodeConfigs(res, plotIds, true);
    charts = [
      { title: `Bode genlik: ${plotIds.join(', ')}`, url: renderChartPNG(mag) },
      { title: `Bode faz: ${plotIds.join(', ')}`, url: renderChartPNG(ph) },
    ];
  }
  if (charts.length) {
    heading('Grafikler');
    for (const c of charts) {
      const h = (CW * 640) / 1600;
      ensure(h + 8);
      doc.setFontSize(9);
      doc.setTextColor(29, 36, 51);
      doc.text(c.title, M, y + 3);
      doc.addImage(c.url, 'PNG', M, y + 5, CW, h, undefined, 'FAST');
      y += h + 9;
    }
  }

  // 7) Ek: netlist ve MNA matrisi
  if (r.includeSolution) {
    doc.addPage();
    y = M;
    heading('Ek — Netlist');
    autoTable(doc, {
      ...tableDefaults,
      startY: y,
      head: [['Eleman', 'Düğüm +', 'Düğüm −', 'Değer']],
      body: netlistText(r.netlist)
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const t = l.trim().split(/\s+/);
          return [t[0], t[1], t[2], t.slice(3).join(' ')];
        }),
    });
    y = after();
    heading('Ek — MNA matrisi  A · x = b');
    const sys = res.system;
    doc.setFontSize(8.5);
    doc.setTextColor(107, 114, 128);
    const noteL = doc.splitTextToSize(sys.note, CW);
    doc.text(noteL, M, y);
    y += noteL.length * 4 + 2;
    const N = sys.labels.length;
    const fs = N > 10 ? 6 : N > 6 ? 7 : 8;
    autoTable(doc, {
      ...tableDefaults,
      startY: y,
      head: [['', ...sys.labels, 'b', 'x']],
      body: sys.A.map((row, i) => [sys.labels[i], ...row.map(fmtCell), fmtCell(sys.b[i]), fmtCell(sys.x[i])]),
      styles: { ...tableDefaults.styles, fontSize: fs, halign: 'center', cellPadding: 1 },
      columnStyles: { 0: { fontStyle: 'bold' } },
    });
    y = after();
  }

  // Sayfa numaraları
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150, 155, 165);
    doc.text(`${r.header.deney || 'Devre Deneyi'} · ${r.header.ogrenci || ''}`.replace(/ · $/, ''), M, H - 8);
    doc.text(`Sayfa ${p} / ${pages}`, W - M, H - 8, { align: 'right' });
  }
  return doc;
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
