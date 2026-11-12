import { useMemo, useState, type ReactNode } from 'react';
import { compact, percent } from './format';

// Small SVG charts for the dashboard tabs. SVG keeps them sharp when exported as PNG or SVG.

const ACCENT = 'var(--d-accent)';
const GHOST = 'color-mix(in oklab, var(--d-muted) 55%, transparent)';

/** Concentration (Lorenz-style) curves: x = share of items from the largest, y = cumulative share. */
export function ConcentrationChart({ curves, xLabel, yLabel, marker }: {
  curves: Array<{ label: string; points: Array<[number, number]>; ghost?: boolean }>;
  xLabel: string;
  yLabel: string;
  /** The point the headline quotes, e.g. the top 10% of items (rounded up to whole items) and their share. */
  marker?: { x: number; y: number; label: string };
}) {
  const width = 520;
  const height = 250;
  const pad = { left: 44, right: 12, top: 10, bottom: 34 };
  const x = (value: number) => pad.left + value * (width - pad.left - pad.right);
  const y = (value: number) => height - pad.bottom - value * (height - pad.top - pad.bottom);
  const path = (points: Array<[number, number]>) => points.map(([px, py], index) => `${index ? 'L' : 'M'}${x(px).toFixed(1)},${y(py).toFixed(1)}`).join(' ');
  return (
    <svg className="dash-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${yLabel} by ${xLabel}`}>
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
        <g key={tick}>
          <line className="is-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
          <text x={pad.left - 6} y={y(tick) + 3} textAnchor="end">{percent(tick)}</text>
          <text x={x(tick)} y={height - pad.bottom + 14} textAnchor="middle">{percent(tick)}</text>
        </g>
      ))}
      <line className="is-axis" x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} strokeDasharray="4 4" />
      <text x={x(0.62)} y={y(0.55)} className="dash-chart-note">equal share</text>
      {curves.map((curve) => (
        <path key={curve.label} d={path(curve.points)} fill="none" stroke={curve.ghost ? GHOST : ACCENT} strokeWidth={curve.ghost ? 1.6 : 2.4} strokeDasharray={curve.ghost ? '5 4' : undefined} />
      ))}
      {marker ? (
        <g>
          <line className="is-axis" x1={x(marker.x)} x2={x(marker.x)} y1={y(0)} y2={y(marker.y)} strokeDasharray="2 3" />
          <circle cx={x(marker.x)} cy={y(marker.y)} r={4} fill={ACCENT} />
          <text x={x(marker.x) + 7} y={y(marker.y) + 12} className="dash-chart-strong">{marker.label}</text>
        </g>
      ) : null}
      <text x={(pad.left + width - pad.right) / 2} y={height - 4} textAnchor="middle">{xLabel}</text>
      <text transform={`translate(11 ${(pad.top + height - pad.bottom) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
    </svg>
  );
}

export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  highlight?: boolean;
  title: string;
  detail: string;
}

/** 0 and round steps (1, 2 or 5 × 10ⁿ) up to `max`. */
function niceTicks(max: number): number[] {
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-9)));
  const step = ([1, 2, 5, 10].find((candidate) => candidate * power >= rough) ?? 10) * power;
  const ticks: number[] = [];
  for (let value = 0; value <= max + 1e-9; value += step) ticks.push(Number(value.toPrecision(6)));
  return ticks;
}

const logTicks = (min: number, max: number) => {
  const ticks: number[] = [];
  for (let power = Math.floor(Math.log10(Math.max(1, min))); power <= Math.ceil(Math.log10(Math.max(1, max))); power += 1) ticks.push(10 ** power);
  return ticks;
};

const YEAR_FMT = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'UTC' });
const MONTH_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });

/** Ticks at the start of years (or months, for spans under two years), thinned to about eight. */
function timeTicks(min: number, max: number): Array<{ value: number; label: string }> {
  const ticks: Array<{ value: number; label: string }> = [];
  const byYear = max - min > 2 * 365.25 * 86_400_000;
  const start = new Date(min);
  let cursor = byYear ? Date.UTC(start.getUTCFullYear() + 1, 0, 1) : Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
  while (cursor <= max) {
    ticks.push({ value: cursor, label: byYear ? YEAR_FMT.format(cursor) : MONTH_FMT.format(cursor) });
    const date = new Date(cursor);
    cursor = byYear ? Date.UTC(date.getUTCFullYear() + 1, 0, 1) : Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  }
  const every = Math.max(1, Math.ceil(ticks.length / 8));
  return ticks.filter((_, index) => index % every === 0);
}

/** Scatter with a log or time x axis (and optionally log y); click a dot to open it, hover for details. */
export function ScatterChart({ points, ghost = [], xLabel, yLabel, yLog = false, xScale = 'log', line, onSelect, legend }: {
  points: ScatterPoint[];
  ghost?: Array<{ x: number; y: number }>;
  xLabel: string;
  yLabel: string;
  yLog?: boolean;
  xScale?: 'log' | 'time';
  /** A trend line drawn over the dots, e.g. median views per period. */
  line?: Array<{ x: number; y: number }>;
  onSelect?: (id: string) => void;
  legend?: ReactNode;
}) {
  const [hover, setHover] = useState<ScatterPoint | null>(null);
  const width = 640;
  const height = 300;
  const pad = { left: 52, right: 14, top: 12, bottom: 36 };
  const all = [...points, ...ghost];
  const xs = all.map((point) => point.x).filter((value) => value > 0);
  const ys = all.map((point) => point.y).filter((value) => Number.isFinite(value));
  const isTime = xScale === 'time';
  const xMin = isTime ? Math.min(...xs) : Math.max(1, 10 ** Math.floor(Math.log10(Math.max(1, Math.min(...xs)))));
  const xMax = isTime ? Math.max(...xs, xMin + 1) : Math.max(...xs, xMin * 10);
  // Clip the y axis at the 99th percentile so one extreme video doesn't flatten the rest.
  const sortedY = [...ys].sort((a, b) => a - b);
  const yMaxRaw = sortedY.length ? sortedY[Math.min(sortedY.length - 1, Math.floor(sortedY.length * 0.99))] : 1;
  const yMax = Math.max(yMaxRaw * 1.05, 1);
  const yMin = yLog ? 10 ** Math.floor(Math.log10(Math.max(1, Math.min(...ys.filter((value) => value > 0))))) : 0;
  const lx = (value: number) => Math.log10(Math.max(value, 1));
  const x = (value: number) => pad.left + (isTime
    ? (value - xMin) / Math.max(1, xMax - xMin)
    : (lx(value) - lx(xMin)) / Math.max(0.0001, lx(xMax) - lx(xMin))) * (width - pad.left - pad.right);
  const y = (value: number) => {
    const clipped = Math.min(value, yMax);
    const ratio = yLog ? (lx(clipped) - lx(yMin)) / Math.max(0.0001, lx(yMax) - lx(yMin)) : (clipped - yMin) / Math.max(0.0001, yMax - yMin);
    return height - pad.bottom - ratio * (height - pad.top - pad.bottom);
  };
  const yTicks = yLog ? logTicks(yMin, yMax) : niceTicks(yMax);
  return (
    <div className="dash-scatter">
      <svg className="dash-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${yLabel} against ${xLabel}`} onPointerLeave={() => setHover(null)}>
        {(isTime ? timeTicks(xMin, xMax) : logTicks(xMin, xMax).map((value) => ({ value, label: compact.format(value) }))).map((tick) => (
          <g key={`x${tick.value}`}>
            <line className="is-grid" x1={x(tick.value)} x2={x(tick.value)} y1={pad.top} y2={height - pad.bottom} />
            <text x={x(tick.value)} y={height - pad.bottom + 14} textAnchor="middle">{tick.label}</text>
          </g>
        ))}
        {yTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line className="is-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
            <text x={pad.left - 6} y={y(tick) + 3} textAnchor="end">{compact.format(tick)}</text>
          </g>
        ))}
        {ghost.map((point, index) => <circle key={`g${index}`} cx={x(point.x)} cy={y(point.y)} r={2.4} fill={GHOST} />)}
        {points.filter((point) => !point.highlight).map((point) => (
          <circle key={point.id} cx={x(point.x)} cy={y(point.y)} r={3.2} className="dash-dot" onPointerEnter={() => setHover(point)} onClick={() => onSelect?.(point.id)} />
        ))}
        {points.filter((point) => point.highlight).map((point) => (
          <circle key={point.id} cx={x(point.x)} cy={y(point.y)} r={4.4} className="dash-dot is-highlight" onPointerEnter={() => setHover(point)} onClick={() => onSelect?.(point.id)} />
        ))}
        {line && line.length > 1 ? (
          <path d={line.map((point, index) => `${index ? 'L' : 'M'}${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`).join(' ')} fill="none" stroke="var(--d-text)" strokeWidth={2} strokeLinejoin="round" />
        ) : null}
        {hover ? <circle cx={x(hover.x)} cy={y(hover.y)} r={7} fill="none" stroke={ACCENT} strokeWidth={1.5} /> : null}
        <text x={(pad.left + width - pad.right) / 2} y={height - 4} textAnchor="middle">{xLabel}</text>
        <text transform={`translate(12 ${(pad.top + height - pad.bottom) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
      </svg>
      <div className="dash-scatter-foot">
        {hover ? <span className="dash-scatter-hover"><strong>{hover.title}</strong> · {hover.detail}</span> : <span className="dash-note">Hover a dot for details{onSelect ? ', click to open the video' : ''}.</span>}
        {legend}
      </div>
    </div>
  );
}

/** Weekday × hour heatmap. */
export function RhythmHeatmap({ grid, max, ghost }: { grid: number[][]; max: number; ghost?: { grid: number[][]; total: number; ownTotal: number } }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const [hover, setHover] = useState<{ day: number; hour: number } | null>(null);
  const cell = (day: number, hour: number) => grid[day]?.[hour] ?? 0;
  const label = hover ? `${days[hover.day]} ${String(hover.hour).padStart(2, '0')}:00–${String(hover.hour).padStart(2, '0')}:59 · ${cell(hover.day, hover.hour)} videos${ghost ? ` · comparison: ${percent((ghost.grid[hover.day]?.[hover.hour] ?? 0) / Math.max(1, ghost.total), 1)} vs ${percent(cell(hover.day, hover.hour) / Math.max(1, ghost.ownTotal), 1)} here` : ''}` : null;
  return (
    <div className="dash-heatmap" onPointerLeave={() => setHover(null)}>
      <div className="dash-heatmap-grid" role="table" aria-label="Uploads by weekday and hour">
        <span />
        {Array.from({ length: 24 }, (_, hour) => <span key={hour} className="dash-heatmap-hour">{hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>)}
        {days.map((day, dayIndex) => (
          <div className="dash-heatmap-row" role="row" key={day}>
            <span className="dash-heatmap-day">{day}</span>
            {Array.from({ length: 24 }, (_, hour) => {
              const value = cell(dayIndex, hour);
              return (
                <span
                  key={hour}
                  role="cell"
                  className="dash-heatmap-cell"
                  style={{ background: value ? `color-mix(in oklab, var(--d-accent) ${Math.round(12 + (value / Math.max(1, max)) * 88)}%, var(--d-card))` : undefined }}
                  onPointerEnter={() => setHover({ day: dayIndex, hour })}
                  aria-label={`${day} ${hour}:00, ${value} videos`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="dash-note dash-heatmap-label">{label ?? 'Hover a cell for the count.'}</div>
    </div>
  );
}

/** A word cloud whose font sizes are proportional to the square root of each term's share. */
export function WordCloud({ terms, onSelect }: {
  terms: Array<{ key: string; label: string; share: number; videos: number }>;
  onSelect?: (key: string) => void;
}) {
  const width = 560;
  const height = 260;
  const words = useMemo(() => layoutCloud(terms.slice(0, 60), width, height), [terms]);
  if (!words.length) return <div className="dash-empty">No terms to show.</div>;
  return (
    <svg className="dash-chart dash-cloud" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Word cloud">
      {words.map((word) => (
        <text
          key={word.key}
          x={word.x}
          y={word.y}
          textAnchor="middle"
          dominantBaseline="middle"
          className={`dash-cloud-word ${onSelect ? 'is-interactive' : ''}`}
          style={{ opacity: word.opacity, fontSize: word.size }}
          onClick={() => onSelect?.(word.key)}
        >
          <title>{`${word.label}: ${word.videos} videos (${percent(word.share, 1)})`}</title>
          {word.label}
        </text>
      ))}
    </svg>
  );
}

let measureContext: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, size: number): number {
  if (measureContext === undefined) {
    try {
      measureContext = document.createElement('canvas').getContext('2d');
    } catch {
      measureContext = null;
    }
  }
  if (measureContext) {
    measureContext.font = `600 ${size}px Inter, system-ui, sans-serif`;
    return measureContext.measureText(text).width;
  }
  return text.length * size * 0.56;
}

/** Places words on an Archimedean spiral from the centre, largest first, skipping overlaps. */
export function layoutCloud(terms: Array<{ key: string; label: string; share: number; videos: number }>, width: number, height: number) {
  const maxShare = Math.max(...terms.map((term) => term.share), 0.0001);
  const placed: Array<{ key: string; label: string; share: number; videos: number; x: number; y: number; size: number; opacity: number; w: number; h: number }> = [];
  terms.forEach((term, index) => {
    const size = Math.max(10, Math.round(8 + 30 * Math.sqrt(term.share / maxShare)));
    const w = textWidth(term.label, size) + 6;
    const h = size * 1.05;
    for (let step = 0; step < 1400; step += 1) {
      const angle = step * 0.32;
      const radius = 2.2 * angle;
      const x = width / 2 + radius * Math.cos(angle) * 1.7;
      const y = height / 2 + radius * Math.sin(angle);
      if (x - w / 2 < 2 || x + w / 2 > width - 2 || y - h / 2 < 2 || y + h / 2 > height - 2) continue;
      const overlaps = placed.some((other) => Math.abs(other.x - x) * 2 < other.w + w && Math.abs(other.y - y) * 2 < other.h + h);
      if (overlaps) continue;
      placed.push({ ...term, x, y, size, opacity: Math.max(0.55, 1 - index * 0.01), w, h });
      break;
    }
  });
  return placed;
}

export interface NetworkNode { id: string; label: string; kind: 'tag' | 'hashtag'; videos: number }
export interface NetworkEdge { source: string; target: string; weight: number }

/** For display, each term's strongest links: dense tag templates otherwise draw an unreadable hairball. */
export function backboneEdges(edges: NetworkEdge[], perNode = 3): NetworkEdge[] {
  const kept = new Set<NetworkEdge>();
  const byNode = new Map<string, NetworkEdge[]>();
  edges.forEach((edge) => {
    [edge.source, edge.target].forEach((id) => byNode.set(id, [...(byNode.get(id) ?? []), edge]));
  });
  byNode.forEach((list) => [...list].sort((a, b) => b.weight - a.weight).slice(0, perNode).forEach((edge) => kept.add(edge)));
  return edges.filter((edge) => kept.has(edge));
}

/**
 * Fruchterman–Reingold layout with gentle gravity, from a deterministic spiral start, so the same data
 * always gets the same picture.
 */
export function layoutNetwork(nodes: NetworkNode[], edges: NetworkEdge[], width: number, height: number) {
  const margin = 48;
  const positions = nodes.map((_, index) => {
    const angle = index * 2.399963;
    const radius = 18 * Math.sqrt(index + 1);
    return { x: width / 2 + radius * Math.cos(angle), y: height / 2 + radius * Math.sin(angle) };
  });
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const links = edges.flatMap((edge) => {
    const source = indexById.get(edge.source);
    const target = indexById.get(edge.target);
    return source === undefined || target === undefined ? [] : [{ source, target, weight: edge.weight }];
  });
  const maxWeight = Math.max(1, ...links.map((link) => link.weight));
  const k = 0.9 * Math.sqrt(((width - 2 * margin) * (height - 2 * margin)) / Math.max(1, nodes.length));
  const iterations = 300;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const temperature = (width / 12) * (1 - iteration / iterations) + 0.5;
    const shift = positions.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const distance = Math.max(Math.hypot(dx, dy), 1);
        const force = (k * k) / distance;
        shift[i].x += (dx / distance) * force; shift[i].y += (dy / distance) * force;
        shift[j].x -= (dx / distance) * force; shift[j].y -= (dy / distance) * force;
      }
    }
    links.forEach((link) => {
      const a = positions[link.source];
      const b = positions[link.target];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      const force = ((distance * distance) / k) * (0.3 + 0.7 * (link.weight / maxWeight));
      shift[link.source].x -= (dx / distance) * force; shift[link.source].y -= (dy / distance) * force;
      shift[link.target].x += (dx / distance) * force; shift[link.target].y += (dy / distance) * force;
    });
    positions.forEach((position, index) => {
      shift[index].x += (width / 2 - position.x) * 0.6;
      shift[index].y += (height / 2 - position.y) * 1.2;
      const length = Math.max(Math.hypot(shift[index].x, shift[index].y), 0.0001);
      const step = Math.min(length, temperature);
      position.x = Math.min(width - margin, Math.max(margin, position.x + (shift[index].x / length) * step));
      position.y = Math.min(height - 20, Math.max(20, position.y + (shift[index].y / length) * step));
    });
  }
  return { positions, links, maxWeight };
}

export function NetworkGraph({ nodes, edges, onSelect }: { nodes: NetworkNode[]; edges: NetworkEdge[]; onSelect?: (node: NetworkNode) => void }) {
  const width = 900;
  const height = 420;
  const [hover, setHover] = useState<string | null>(null);
  const shown = useMemo(() => backboneEdges(edges), [edges]);
  const layout = useMemo(() => layoutNetwork(nodes, shown, width, height), [nodes, shown]);
  // Label the bigger nodes; the rest show their label on hover.
  const labelled = useMemo(() => new Set([...nodes].sort((a, b) => b.videos - a.videos).slice(0, 18).map((node) => node.id)), [nodes]);
  if (!nodes.length) return <div className="dash-empty">Not enough tags or hashtags shared by two or more videos.</div>;
  const maxVideos = Math.max(...nodes.map((node) => node.videos), 1);
  const neighbours = new Set<number>();
  const hoverIndex = hover ? nodes.findIndex((node) => node.id === hover) : -1;
  if (hoverIndex >= 0) layout.links.forEach((link) => {
    if (link.source === hoverIndex) neighbours.add(link.target);
    if (link.target === hoverIndex) neighbours.add(link.source);
  });
  return (
    <svg className="dash-chart dash-network" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Tag and hashtag co-occurrence network" onPointerLeave={() => setHover(null)}>
      {layout.links.map((link, index) => {
        const active = hoverIndex >= 0 && (link.source === hoverIndex || link.target === hoverIndex);
        return (
          <line
            key={index}
            x1={layout.positions[link.source].x}
            y1={layout.positions[link.source].y}
            x2={layout.positions[link.target].x}
            y2={layout.positions[link.target].y}
            stroke={active ? ACCENT : 'var(--d-line)'}
            strokeOpacity={hoverIndex >= 0 && !active ? 0.15 : 0.7}
            strokeWidth={0.6 + 3 * (link.weight / layout.maxWeight)}
          />
        );
      })}
      {nodes.map((node, index) => {
        const radius = 4 + 12 * Math.sqrt(node.videos / maxVideos);
        const dim = hoverIndex >= 0 && index !== hoverIndex && !neighbours.has(index);
        return (
          <g
            key={node.id}
            transform={`translate(${layout.positions[index].x} ${layout.positions[index].y})`}
            className={`dash-node is-${node.kind} ${onSelect ? 'is-interactive' : ''}`}
            style={{ opacity: dim ? 0.25 : 1 }}
            onPointerEnter={() => setHover(node.id)}
            onClick={() => onSelect?.(node)}
          >
            <title>{`${node.label}: ${node.videos} videos`}</title>
            <circle r={radius} />
            {labelled.has(node.id) || hover === node.id || neighbours.has(index) ? <text y={radius + 11} textAnchor="middle">{node.label}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

/** A table of shaded cells: rows (channels or terms) × columns (periods). */
export function PeriodHeatTable({ periods, rows, format, ariaLabel }: {
  periods: string[];
  rows: Array<{ key: string; label: string; values: number[]; total: string; onSelect?: () => void }>;
  format: (value: number) => string;
  ariaLabel: string;
}) {
  const max = Math.max(...rows.flatMap((row) => row.values), 0.0001);
  return (
    <div className="dash-table-wrap">
      <table className="dash-table dash-period-table" aria-label={ariaLabel}>
        <thead>
          <tr>
            <th className="is-text" />
            {periods.map((period) => <th key={period}>{period}</th>)}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.onSelect ? 'is-interactive' : undefined} onClick={row.onSelect}>
              <td className="is-text is-title" title={row.label}>{row.label}</td>
              {row.values.map((value, index) => (
                <td key={periods[index]} className="dash-period-cell" style={{ background: value ? `color-mix(in oklab, var(--d-accent) ${Math.round(10 + (value / max) * 80)}%, transparent)` : undefined }} title={`${row.label}, ${periods[index]}: ${format(value)}`}>
                  {value ? format(value) : ''}
                </td>
              ))}
              <td>{row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
