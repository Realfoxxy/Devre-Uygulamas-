// R, L, C, V, I, GND, voltmetre ve ampermetre çizimleri (yerel koordinatlar, G = 20 px).
import { Component, CompType, Params, Pt, rotatePt } from '../../core/circuit';
import { describeValue } from '../../core/netlist';

export const G = 20;

export interface Theme {
  stroke: string;
  fill: string;
  label: string;
  value: string;
  muted: string;
  font: string;
}

export const PRINT_THEME: Theme = {
  stroke: '#1d2433',
  fill: '#ffffff',
  label: '#1d2433',
  value: '#2149b8',
  muted: '#6b7280',
  font: 'DejaVuSans, sans-serif',
};

function Lead({ from, to, stroke }: { from: number; to: number; stroke: string }) {
  return <line x1={from} y1={0} x2={to} y2={0} stroke={stroke} strokeWidth={2} strokeLinecap="round" />;
}

/** Gövde (döndürülmüş grup içinde çizilir). */
function Body({ type, params, t }: { type: CompType; params: Params; t: Theme }) {
  const s = t.stroke;
  const sw = 2;
  switch (type) {
    case 'R':
      return (
        <g>
          <Lead from={-40} to={-24} stroke={s} />
          <polyline
            points="-24,0 -20,-8 -12,8 -4,-8 4,8 12,-8 20,8 24,0"
            fill="none"
            stroke={s}
            strokeWidth={sw}
            strokeLinejoin="round"
          />
          <Lead from={24} to={40} stroke={s} />
        </g>
      );
    case 'C':
      return (
        <g>
          <Lead from={-40} to={-5} stroke={s} />
          <line x1={-5} y1={-14} x2={-5} y2={14} stroke={s} strokeWidth={2.6} />
          <line x1={5} y1={-14} x2={5} y2={14} stroke={s} strokeWidth={2.6} />
          <Lead from={5} to={40} stroke={s} />
        </g>
      );
    case 'L':
      return (
        <g>
          <Lead from={-40} to={-24} stroke={s} />
          <path
            d="M-24 0 a6 6 0 0 1 12 0 a6 6 0 0 1 12 0 a6 6 0 0 1 12 0 a6 6 0 0 1 12 0"
            fill="none"
            stroke={s}
            strokeWidth={sw}
          />
          <Lead from={24} to={40} stroke={s} />
        </g>
      );
    case 'V':
      return (
        <g>
          <Lead from={-40} to={-16} stroke={s} />
          <circle r={16} fill={t.fill} stroke={s} strokeWidth={sw} />
          {params.mode === 'AC' && (
            <path d="M-10 0 q5 -12 10 0 t10 0" fill="none" stroke={s} strokeWidth={1.8} />
          )}
          <Lead from={16} to={40} stroke={s} />
        </g>
      );
    case 'I':
      return (
        <g>
          <Lead from={-40} to={-16} stroke={s} />
          <circle r={16} fill={t.fill} stroke={s} strokeWidth={sw} />
          <line x1={-9} y1={0} x2={5} y2={0} stroke={s} strokeWidth={2} />
          <polygon points="10,0 3,-5 3,5" fill={s} />
          {params.mode === 'AC' && <path d="M-8 9 q2 -5 4 0 t4 0" fill="none" stroke={s} strokeWidth={1.2} />}
          <Lead from={16} to={40} stroke={s} />
        </g>
      );
    case 'VM':
    case 'AM':
      return (
        <g>
          <Lead from={-40} to={-15} stroke={s} />
          <circle r={15} fill={type === 'VM' ? '#eef6ee' : '#fdf3e6'} stroke={s} strokeWidth={sw} />
          <Lead from={15} to={40} stroke={s} />
        </g>
      );
    case 'E':
    case 'H':
    case 'G':
    case 'F':
      // Kitaptaki gibi eşkenar dörtgen: gerilim çıkışlılarda + −, akım çıkışlılarda ok
      return (
        <g>
          <Lead from={-40} to={-17} stroke={s} />
          <polygon points="-17,0 0,-17 17,0 0,17" fill={t.fill} stroke={s} strokeWidth={sw} strokeLinejoin="round" />
          {(type === 'G' || type === 'F') && (
            <>
              <line x1={-9} y1={0} x2={5} y2={0} stroke={s} strokeWidth={2} />
              <polygon points="10,0 3,-5 3,5" fill={s} />
            </>
          )}
          <Lead from={17} to={40} stroke={s} />
        </g>
      );
    case 'GND':
      return (
        <g>
          <line x1={0} y1={0} x2={0} y2={10} stroke={s} strokeWidth={2} />
          <line x1={-13} y1={10} x2={13} y2={10} stroke={s} strokeWidth={2.4} />
          <line x1={-8} y1={15} x2={8} y2={15} stroke={s} strokeWidth={2.2} />
          <line x1={-3} y1={20} x2={3} y2={20} stroke={s} strokeWidth={2} />
        </g>
      );
  }
}

/** Döndürmeden bağımsız dik duran yazılar (+, −, V, A). Konumlar yerel koordinatlarda. */
function uprightMarks(type: CompType, params: Params): { at: Pt; text: string; size: number; bold?: boolean }[] {
  switch (type) {
    case 'V':
      return params.mode === 'AC'
        ? [{ at: [-24, -11], text: '+', size: 13, bold: true }]
        : [
            { at: [-8, 0], text: '+', size: 14, bold: true },
            { at: [8, 0], text: '−', size: 14, bold: true },
          ];
    case 'E':
    case 'H':
      return [
        { at: [-7, 0], text: '+', size: 13, bold: true },
        { at: [7, 0], text: '−', size: 13, bold: true },
      ];
    case 'VM':
      return [
        { at: [0, 0], text: 'V', size: 15, bold: true },
        { at: [-24, -11], text: '+', size: 12, bold: true },
      ];
    case 'AM':
      return [
        { at: [0, 0], text: 'A', size: 15, bold: true },
        { at: [-24, -11], text: '+', size: 12, bold: true },
      ];
    case 'R':
    case 'C':
    case 'L':
      return [{ at: [-33, -9], text: '+', size: 11 }];
    default:
      return [];
  }
}

export function PartSymbol({
  comp,
  theme,
  stroke,
  opacity,
}: {
  comp: Pick<Component, 'type' | 'x' | 'y' | 'rot' | 'params'>;
  theme: Theme;
  stroke?: string;
  opacity?: number;
}) {
  const t = stroke ? { ...theme, stroke } : theme;
  return (
    <g transform={`translate(${comp.x * G} ${comp.y * G})`} opacity={opacity}>
      <g transform={`rotate(${comp.rot})`}>
        <Body type={comp.type} params={comp.params} t={t} />
      </g>
      {uprightMarks(comp.type, comp.params).map((m, i) => {
        const [x, y] = rotatePt(m.at, comp.rot);
        const passive = comp.type === 'R' || comp.type === 'C' || comp.type === 'L';
        return (
          <text
            key={i}
            x={x}
            y={y}
            fontSize={m.size}
            fontFamily={theme.font}
            fontWeight={m.bold ? 700 : 400}
            textAnchor="middle"
            dominantBaseline="central"
            fill={passive ? theme.muted : t.stroke}
          >
            {m.text}
          </text>
        );
      })}
    </g>
  );
}

/** İsim ve değer etiketi (her zaman dik). */
export function PartLabel({
  comp,
  theme,
  extra,
  extraColor,
}: {
  comp: Component;
  theme: Theme;
  extra?: string;
  extraColor?: string;
}) {
  if (comp.type === 'GND') return null;
  const vertical = comp.rot % 180 !== 0;
  const value = comp.type === 'VM' || comp.type === 'AM' ? '' : describeValue(comp.type, comp.params);
  const cx = comp.x * G;
  const cy = comp.y * G;
  const lines = [
    { text: comp.id, color: theme.label, weight: 700 },
    ...(value ? [{ text: value, color: theme.value, weight: 400 }] : []),
    ...(extra ? [{ text: extra, color: extraColor ?? theme.value, weight: 700 }] : []),
  ];
  const lh = 13;
  if (vertical) {
    const x = cx + 26;
    const y0 = cy - ((lines.length - 1) * lh) / 2;
    return (
      <g pointerEvents="none">
        {lines.map((l, i) => (
          <text key={i} x={x} y={y0 + i * lh} fontSize={11.5} fontFamily={theme.font} fill={l.color} fontWeight={l.weight} dominantBaseline="central">
            {l.text}
          </text>
        ))}
      </g>
    );
  }
  const y0 = cy - 22 - (lines.length - 1) * lh;
  return (
    <g pointerEvents="none">
      {lines.map((l, i) => (
        <text key={i} x={cx} y={y0 + i * lh} fontSize={11.5} fontFamily={theme.font} fill={l.color} fontWeight={l.weight} textAnchor="middle" dominantBaseline="central">
          {l.text}
        </text>
      ))}
    </g>
  );
}

/** Palet için küçük simge. */
export function PartIcon({ type, size = 44 }: { type: CompType; size?: number }) {
  const t: Theme = { ...PRINT_THEME, fill: 'transparent', font: 'inherit' };
  const comp = { type, x: 0, y: 0, rot: 0, params: type === 'V' || type === 'I' ? { mode: 'DC' as const } : {} };
  const vb = type === 'GND' ? '-24 -6 48 32' : '-44 -22 88 44';
  return (
    <svg width={size} height={type === 'GND' ? size * 0.66 : size / 2} viewBox={vb} aria-hidden>
      <PartSymbol comp={comp} theme={t} />
    </svg>
  );
}
