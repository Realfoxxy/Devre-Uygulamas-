// Şemayı ızgarasız, beyaz zeminli bağımsız bir SVG olarak üretir (PDF, SVG ve PNG için).
import { renderToStaticMarkup } from 'react-dom/server';
import type { Component, Wire } from '../core/circuit';
import type { Netlist } from '../core/netlist';
import type { AnalysisResult } from '../core/results';
import { PRINT_THEME } from '../ui/parts/symbols';
import { Schematic, schematicBounds } from '../ui/Schematic';

export interface SchematicExport {
  markup: string;
  width: number;
  height: number;
}

export function schematicSvg(opts: {
  components: Component[];
  wires: Wire[];
  results?: AnalysisResult | null;
  netlist?: Netlist | null;
  tIndex?: number | null;
  acMeasure?: 'rms' | 'peak';
  nodeLabels?: boolean;
}): SchematicExport {
  const b = schematicBounds(opts.components, opts.wires);
  // düğüm etiketleri için üstte biraz pay
  const extra = 16;
  const x = b.x - extra;
  const y = b.y - extra;
  const w = b.w + 2 * extra;
  const h = b.h + 2 * extra;
  const markup = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width={w} height={h} viewBox={`${x} ${y} ${w} ${h}`}>
      <rect x={x} y={y} width={w} height={h} fill="#ffffff" />
      <Schematic
        components={opts.components}
        wires={opts.wires}
        theme={PRINT_THEME}
        results={opts.results}
        netlist={opts.netlist}
        tIndex={opts.tIndex}
        showNodeLabels={opts.nodeLabels ?? true}
        acMeasure={opts.acMeasure}
      />
    </svg>,
  );
  return { markup, width: w, height: h };
}

export function svgToPngDataUrl(svg: SchematicExport, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg.markup], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.ceil(svg.width * scale);
      c.height = Math.ceil(svg.height * scale);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}
