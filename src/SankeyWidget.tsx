import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './sankey.css';

export interface FlowRow {
  source: string;
  stage: string;
  target: string;
  value: number;
}

export interface SankeyWidgetProps {
  flows?: FlowRow[];
  endpoint?: string;
  ifid?: number;
  timeRange?: string;
  refreshMs?: number;
  maxFlows?: number;
  dark?: boolean;
  title?: string;
}

interface SankeyNode {
  id: string;
  label: string;
  column: number;
  y: number;
  height: number;
  totalValue: number;
  color: string;
}

interface SankeyLink {
  sourceNode: SankeyNode;
  targetNode: SankeyNode;
  value: number;
  thickness: number;
  color: string;
  stage: string;
  flowIndex: number;
}

interface Particle {
  t: number;
  speed: number;
  flowIndex: number;
  size: number;
  color: string;
  opacity: number;
  trailLength: number;
}

const STAGE_COLORS: Record<string, string> = {
  Visit: '#22d3ee',
  Signup: '#a78bfa',
  Demo: '#60a5fa',
  Purchase: '#34d399',
  Retention: '#fbbf24',
  Feedback: '#f97316',
  Other: '#94a3b8',
};

const TIME_RANGES = ['1h', '6h', '24h', '7d'];
const NODE_WIDTH = 24;
const NODE_GAP = 8;
const PADDING_TOP = 55;
const PADDING_BOTTOM = 35;
const PADDING_LEFT = 30;
const PADDING_RIGHT = 30;
const COLUMN_HEADER_HEIGHT = 36;
const DEFAULT_MAX_FLOWS = 30;
const PARTICLES_PER_LINK = 4;

function bezierPoint(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.startsWith('#') ? hex : '#94a3b8';
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getStageColor(stage: string): string {
  return STAGE_COLORS[stage] || STAGE_COLORS.Other;
}

function fitLabel(ctx: CanvasRenderingContext2D, label: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(label).width <= maxWidth) return label;
  for (let i = label.length - 1; i > 0; i--) {
    const truncated = `${label.slice(0, i)}...`;
    if (ctx.measureText(truncated).width <= maxWidth) return truncated;
  }
  return '...';
}

function formatValue(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

function normalizeRows(raw: unknown, maxFlows: number): FlowRow[] {
  const rows = Array.isArray((raw as { rows?: unknown[] })?.rows)
    ? (raw as { rows: unknown[] }).rows
    : Array.isArray(raw)
      ? raw
      : [];

  return rows
    .map((row): FlowRow | null => {
      if (Array.isArray(row)) {
        return {
          source: String(row[0] ?? 'Unknown'),
          stage: String(row[1] ?? 'Other'),
          target: String(row[2] ?? 'Unknown'),
          value: Number(row[3] ?? 0),
        };
      }
      if (row && typeof row === 'object') {
        const r = row as Partial<FlowRow>;
        return {
          source: String(r.source ?? 'Unknown'),
          stage: String(r.stage ?? 'Other'),
          target: String(r.target ?? 'Unknown'),
          value: Number(r.value ?? 0),
        };
      }
      return null;
    })
    .filter((row): row is FlowRow => Boolean(row && Number.isFinite(row.value) && row.value > 0))
    .sort((a, b) => b.value - a.value)
    .slice(0, maxFlows);
}

function getColumnX(column: number, canvasWidth: number): number {
  const drawableWidth = canvasWidth - PADDING_LEFT - PADDING_RIGHT;
  if (column === 0) return PADDING_LEFT;
  if (column === 1) return PADDING_LEFT + drawableWidth / 2 - NODE_WIDTH / 2;
  return PADDING_LEFT + drawableWidth - NODE_WIDTH;
}

function computeLayout(
  flows: FlowRow[],
  canvasWidth: number,
  canvasHeight: number
): { nodes: SankeyNode[]; links: SankeyLink[] } {
  if (flows.length === 0) return { nodes: [], links: [] };

  const drawableHeight = canvasHeight - PADDING_TOP - PADDING_BOTTOM - COLUMN_HEADER_HEIGHT;
  const sourceMap = new Map<string, number>();
  const protoMap = new Map<string, number>();
  const targetMap = new Map<string, number>();

  for (const flow of flows) {
    sourceMap.set(flow.source, (sourceMap.get(flow.source) || 0) + flow.value);
    protoMap.set(flow.stage, (protoMap.get(flow.stage) || 0) + flow.value);
    targetMap.set(flow.target, (targetMap.get(flow.target) || 0) + flow.value);
  }

  function buildNodes(
    entries: [string, number][],
    column: number,
    colorFn: (label: string) => string
  ): SankeyNode[] {
    const total = entries.reduce((sum, entry) => sum + entry[1], 0);
    const totalGap = Math.max(0, entries.length - 1) * NODE_GAP;
    const availableHeight = Math.max(drawableHeight - totalGap, entries.length * 10);
    let yOffset = PADDING_TOP + COLUMN_HEADER_HEIGHT;

    return entries.map(([label, value]) => {
      const proportion = total > 0 ? value / total : 1 / Math.max(entries.length, 1);
      const height = Math.max(proportion * availableHeight, 12);
      const node: SankeyNode = {
        id: `${column}-${label}`,
        label,
        column,
        y: yOffset,
        height,
        totalValue: value,
        color: colorFn(label),
      };
      yOffset += height + NODE_GAP;
      return node;
    });
  }

  const sourceNodes = buildNodes([...sourceMap.entries()].sort((a, b) => b[1] - a[1]), 0, () => '#3b82f6');
  const stageNodes = buildNodes([...protoMap.entries()].sort((a, b) => b[1] - a[1]), 1, getStageColor);
  const targetNodes = buildNodes([...targetMap.entries()].sort((a, b) => b[1] - a[1]), 2, () => '#10b981');
  const allNodes = [...sourceNodes, ...stageNodes, ...targetNodes];
  const nodeById = new Map(allNodes.map((node) => [node.id, node]));
  const consumed = new Map(allNodes.map((node) => [node.id, 0]));
  const stageLeft = new Map(stageNodes.map((node) => [node.id, 0]));
  const stageRight = new Map(stageNodes.map((node) => [node.id, 0]));
  const maxValue = Math.max(...flows.map((flow) => flow.value), 1);
  const links: SankeyLink[] = [];

  flows
    .map((flow, index) => ({ ...flow, originalIndex: index }))
    .sort((a, b) => b.value - a.value)
    .forEach((flow) => {
      const sourceNode = nodeById.get(`0-${flow.source}`);
      const stageNode = nodeById.get(`1-${flow.stage}`);
      const targetNode = nodeById.get(`2-${flow.target}`);
      if (!sourceNode || !stageNode || !targetNode) return;

      const thickness = Math.max((flow.value / maxValue) * 16, 1.5);
      const color = getStageColor(flow.stage);
      const sourceConsumed = consumed.get(sourceNode.id) || 0;
      const stageLeftConsumed = stageLeft.get(stageNode.id) || 0;
      const stageRightConsumed = stageRight.get(stageNode.id) || 0;
      const targetConsumed = consumed.get(targetNode.id) || 0;

      links.push({
        sourceNode: { ...sourceNode, y: sourceNode.y + sourceConsumed },
        targetNode: { ...stageNode, y: stageNode.y + stageLeftConsumed },
        value: flow.value,
        thickness,
        color,
        stage: flow.stage,
        flowIndex: flow.originalIndex,
      });

      links.push({
        sourceNode: { ...stageNode, y: stageNode.y + stageRightConsumed },
        targetNode: { ...targetNode, y: targetNode.y + targetConsumed },
        value: flow.value,
        thickness,
        color,
        stage: flow.stage,
        flowIndex: flow.originalIndex,
      });

      consumed.set(sourceNode.id, sourceConsumed + thickness + 1);
      stageLeft.set(stageNode.id, stageLeftConsumed + thickness + 1);
      stageRight.set(stageNode.id, stageRightConsumed + thickness + 1);
      consumed.set(targetNode.id, targetConsumed + thickness + 1);
    });

  return { nodes: allNodes, links };
}

export default function SankeyWidget({
  flows: directFlows,
  endpoint = '/api/sankey',
  ifid = 2,
  timeRange: initialTimeRange = '1h',
  refreshMs = 0,
  maxFlows = DEFAULT_MAX_FLOWS,
  dark = true,
  title = 'Sankey Chart',
}: SankeyWidgetProps) {
  const [fetchedFlows, setFetchedFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState(initialTimeRange);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const layoutRef = useRef<{ nodes: SankeyNode[]; links: SankeyLink[] }>({ nodes: [], links: [] });
  const sizeRef = useRef({ w: 900, h: 480 });

  const fetchData = useCallback(async () => {
    if (directFlows) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL(endpoint, window.location.origin);
      url.searchParams.set('time_range', timeRange);
      url.searchParams.set('ifid', String(ifid));
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setFetchedFlows(normalizeRows(await response.json(), maxFlows));
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, [directFlows, endpoint, ifid, maxFlows, timeRange]);

  useEffect(() => {
    fetchData();
    if (!refreshMs || directFlows) return;
    const timer = window.setInterval(fetchData, refreshMs);
    return () => window.clearInterval(timer);
  }, [directFlows, fetchData, refreshMs]);

  const flows = useMemo(
    () => normalizeRows(directFlows || fetchedFlows, maxFlows),
    [directFlows, fetchedFlows, maxFlows]
  );

  const layout = useMemo(
    () => computeLayout(flows, sizeRef.current.w, sizeRef.current.h),
    [flows]
  );

  useEffect(() => {
    layoutRef.current = layout;
    const maxValue = Math.max(...layout.links.map((link) => link.value), 1);
    particlesRef.current = layout.links.flatMap((link, linkIndex) => {
      const proportion = link.value / maxValue;
      const count = Math.max(Math.round(PARTICLES_PER_LINK * (0.5 + proportion * 0.5)), 2);
      return Array.from({ length: count }, () => ({
        t: Math.random(),
        speed: (0.003 + proportion * 0.005) * (0.8 + Math.random() * 0.4),
        flowIndex: linkIndex,
        size: Math.max(1.5, 2 + proportion * 3),
        color: link.color,
        opacity: 0.7 + Math.random() * 0.3,
        trailLength: 3 + Math.floor(proportion * 4),
      }));
    });
  }, [layout]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(640, Math.floor(rect.width));
      const h = 480;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      sizeRef.current = { w, h };
      layoutRef.current = computeLayout(flows, w, h);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [flows]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let running = true;

    const animate = (timestamp: number) => {
      if (!running) return;
      const time = timestamp * 0.001;
      const dpr = window.devicePixelRatio || 1;
      const { w, h } = sizeRef.current;
      const { nodes, links } = layoutRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = dark ? '#0f172a' : '#ffffff';
      ctx.fillRect(0, 0, w, h);

      if (nodes.length === 0) {
        ctx.fillStyle = dark ? '#94a3b8' : '#475569';
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('데이터 대기 중...', w / 2, h / 2);
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      const headers = ['출발지', '단계', '목적지'];
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      headers.forEach((header, column) => {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.shadowColor = dark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.5)';
        ctx.shadowBlur = dark ? 6 : 3;
        ctx.fillStyle = dark ? '#e2e8f0' : '#334155';
        ctx.fillText(header, getColumnX(column, w) + NODE_WIDTH / 2, PADDING_TOP + COLUMN_HEADER_HEIGHT / 2 - 4);
        ctx.restore();
      });

      const maxValue = Math.max(...links.map((link) => link.value), 1);
      links.forEach((link, index) => {
        const srcX = getColumnX(link.sourceNode.column, w) + NODE_WIDTH;
        const dstX = getColumnX(link.targetNode.column, w);
        const srcY = link.sourceNode.y + link.thickness / 2;
        const dstY = link.targetNode.y + link.thickness / 2;
        const cp1x = srcX + (dstX - srcX) * 0.4;
        const cp2x = srcX + (dstX - srcX) * 0.6;
        const opacity = Math.max(
          0.05,
          Math.min(0.42, 0.12 + (link.value / maxValue) * 0.18 + Math.sin(time * 2.5 + index * 0.7) * 0.05)
        );
        ctx.beginPath();
        ctx.moveTo(srcX, srcY);
        ctx.bezierCurveTo(cp1x, srcY, cp2x, dstY, dstX, dstY);
        ctx.strokeStyle = hexToRgba(link.color, opacity);
        ctx.lineWidth = link.thickness;
        ctx.lineCap = 'round';
        ctx.stroke();
      });

      particlesRef.current.forEach((particle) => {
        const link = links[particle.flowIndex];
        if (!link) return;
        const srcX = getColumnX(link.sourceNode.column, w) + NODE_WIDTH;
        const dstX = getColumnX(link.targetNode.column, w);
        const srcY = link.sourceNode.y + link.thickness / 2;
        const dstY = link.targetNode.y + link.thickness / 2;
        const cp1x = srcX + (dstX - srcX) * 0.4;
        const cp2x = srcX + (dstX - srcX) * 0.6;

        for (let i = particle.trailLength; i >= 1; i--) {
          const trailT = ((particle.t - i * particle.speed * 3) % 1 + 1) % 1;
          const tx = bezierPoint(srcX, cp1x, cp2x, dstX, trailT);
          const ty = bezierPoint(srcY, srcY, dstY, dstY, trailT);
          ctx.beginPath();
          ctx.arc(tx, ty, Math.max(particle.size * (1 - i / (particle.trailLength + 1)) * 0.7, 0.5), 0, Math.PI * 2);
          ctx.fillStyle = hexToRgba(particle.color, particle.opacity * (1 - i / (particle.trailLength + 1)) * 0.4);
          ctx.fill();
        }

        const px = bezierPoint(srcX, cp1x, cp2x, dstX, particle.t);
        const py = bezierPoint(srcY, srcY, dstY, dstY, particle.t);
        ctx.beginPath();
        ctx.arc(px, py, particle.size * 2, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(particle.color, particle.opacity * 0.15);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(particle.color, particle.opacity);
        ctx.fill();
        particle.t += particle.speed;
        if (particle.t > 1) particle.t -= 1;
      });

      nodes.forEach((node) => {
        const nx = getColumnX(node.column, w);
        const ny = node.y;
        const glow = Math.sin(time * 2 + node.y * 0.01) * 0.5 + 0.5;
        ctx.save();
        ctx.shadowColor = hexToRgba(node.color, 0.3 + glow * 0.3);
        ctx.shadowBlur = 4 + glow * 8;
        ctx.fillStyle = hexToRgba(node.color, 0.85 + glow * 0.15);
        ctx.beginPath();
        ctx.roundRect(nx, ny, NODE_WIDTH, node.height, Math.min(4, node.height / 2));
        ctx.fill();
        ctx.restore();

        if (node.height < 6) return;
        ctx.save();
        ctx.textBaseline = 'middle';
        if (dark) {
          ctx.shadowColor = 'rgba(0,0,0,0.9)';
          ctx.shadowBlur = 5;
        }
        const centerX = getColumnX(1, w);
        if (node.column === 0) {
          ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.textAlign = 'left';
          ctx.fillStyle = dark ? '#e2e8f0' : '#1e293b';
          const labelX = nx + NODE_WIDTH + 6;
          ctx.fillText(fitLabel(ctx, node.label, centerX - labelX - 10), labelX, ny + node.height / 2);
        } else if (node.column === 2) {
          ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.textAlign = 'right';
          ctx.fillStyle = dark ? '#e2e8f0' : '#1e293b';
          const labelX = nx - 6;
          ctx.fillText(fitLabel(ctx, node.label, labelX - (centerX + NODE_WIDTH) - 10), labelX, ny + node.height / 2);
        } else {
          ctx.font = 'bold 13px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = dark ? '#fbbf24' : '#b45309';
          ctx.fillText(fitLabel(ctx, node.label, 120), nx + NODE_WIDTH / 2, ny - 10);
        }
        ctx.restore();
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => {
      running = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [dark, layout]);

  return (
    <section className={`sankey-widget ${dark ? 'sankey-dark' : 'sankey-light'}`}>
      <header className="sankey-header">
        <div>
          <h2>{title}</h2>
          <p>
            {flows.length} rows
            {lastUpdate ? ` · updated ${lastUpdate.toLocaleTimeString()}` : ''}
          </p>
        </div>
        <div className="sankey-actions">
          {!directFlows &&
            TIME_RANGES.map((range) => (
              <button key={range} className={timeRange === range ? 'active' : ''} onClick={() => setTimeRange(range)}>
                {range}
              </button>
            ))}
          {!directFlows && (
            <button onClick={fetchData} disabled={loading}>
              {loading ? 'Loading' : 'Refresh'}
            </button>
          )}
        </div>
      </header>

      {error && <div className="sankey-error">Error: {error}</div>}

      <div ref={containerRef} className="sankey-canvas-wrap">
        <canvas ref={canvasRef} className="sankey-canvas" />
      </div>

      <div className="sankey-table-wrap">
        <table>
          <thead>
            <tr>
              <th>출발지</th>
              <th>단계</th>
              <th>목적지</th>
              <th>값</th>
            </tr>
          </thead>
          <tbody>
            {flows.map((flow, index) => (
              <tr key={`${flow.source}-${flow.stage}-${flow.target}-${index}`}>
                <td>{flow.source}</td>
                <td style={{ color: getStageColor(flow.stage) }}>
                  <span className="stage-dot" style={{ backgroundColor: getStageColor(flow.stage) }} />
                  {flow.stage}
                </td>
                <td>{flow.target}</td>
                <td>{formatValue(flow.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
