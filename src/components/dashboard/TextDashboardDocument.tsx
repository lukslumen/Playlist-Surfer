import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { DashboardHotspot, DashboardRenderResult, DashboardTabId } from '../../types';

type Props = {
  document: DashboardRenderResult;
  onActivate: (tab: DashboardTabId) => void;
  onMeasure?: (metrics: { charWidth: number; lineHeight: number; documentPixelWidth: number }) => void;
};

type TooltipState = {
  hotspot: DashboardHotspot;
  x: number;
  y: number;
} | null;

const CHAR_SAMPLE = '0'.repeat(64);
const LINE_SAMPLE = `${CHAR_SAMPLE}\n${CHAR_SAMPLE}`;

export default function TextDashboardDocument({ document, onActivate, onMeasure }: Props) {
  const preRef = useRef<HTMLElement | null>(null);
  const probeRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState({ width: 8, height: 20, documentPixelWidth: 960 });
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  useLayoutEffect(() => {
    const measure = () => {
      if (!probeRef.current || !preRef.current) return;
      const probeRect = probeRef.current.getBoundingClientRect();
      const preRect = preRef.current.getBoundingClientRect();
      const charWidth = probeRect.width / 64 || 8;
      const lineHeight = probeRect.height / 2 || 20;
      const next = {
        width: charWidth,
        height: lineHeight,
        documentPixelWidth: preRect.width || document.width * charWidth,
      };
      setMetrics(next);
      onMeasure?.({ charWidth, lineHeight, documentPixelWidth: next.documentPixelWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (preRef.current) observer.observe(preRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [document.text, document.width, onMeasure]);

  const clickableHotspots = useMemo(
    () => document.hotspots.filter((hotspot) => hotspot.action && hotspot.colEnd > hotspot.colStart),
    [document.hotspots],
  );

  const interactiveRegions = useMemo(
    () => document.hotspots.filter((hotspot) => hotspot.helpTitle || hotspot.helpBody),
    [document.hotspots],
  );

  const findHotspotAtPoint = (clientX: number, clientY: number) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = clientX - rect.left + canvasRef.current.scrollLeft;
    const y = clientY - rect.top + canvasRef.current.scrollTop;
    const col = Math.floor(x / metrics.width);
    const line = Math.floor(y / metrics.height);
    return interactiveRegions.find((hotspot) => line >= hotspot.line && line < hotspot.lineEnd && col >= hotspot.colStart && col < hotspot.colEnd) || null;
  };

  const handlePointerMove = (event: MouseEvent<HTMLDivElement>) => {
    const hotspot = findHotspotAtPoint(event.clientX, event.clientY);
    if (!hotspot) {
      setTooltip(null);
      return;
    }
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    setTooltip({
      hotspot,
      x: event.clientX - (canvasRect?.left || 0) + 14,
      y: event.clientY - (canvasRect?.top || 0) + 16,
    });
  };

  useEffect(() => {
    setTooltip(null);
  }, [document.text]);

  return (
    <div className="dashboard-document-shell">
      <pre ref={probeRef} aria-hidden className="dashboard-char-probe">{LINE_SAMPLE}</pre>
      <div
        ref={canvasRef}
        className="dashboard-document-canvas"
        onMouseMove={handlePointerMove}
        onMouseLeave={() => setTooltip(null)}
      >
        <pre ref={preRef} className="dashboard-document-pre">{document.text}</pre>
        <div className="dashboard-hotspot-layer" aria-hidden>
          {clickableHotspots.map((hotspot: DashboardHotspot) => (
            <button
              key={hotspot.id}
              type="button"
              className="dashboard-hotspot"
              style={{
                top: hotspot.line * metrics.height,
                left: hotspot.colStart * metrics.width,
                width: Math.max(metrics.width, (hotspot.colEnd - hotspot.colStart) * metrics.width),
                height: Math.max(metrics.height, (hotspot.lineEnd - hotspot.line) * metrics.height),
              }}
              onClick={() => hotspot.action && onActivate(hotspot.action)}
              title={hotspot.helpTitle || hotspot.action}
              aria-label={hotspot.helpTitle || hotspot.action}
            />
          ))}
        </div>
        {tooltip && (
          <div className="dashboard-help-tooltip" style={{ left: tooltip.x, top: tooltip.y }} role="tooltip">
            <div className="dashboard-help-title">{tooltip.hotspot.helpTitle}</div>
            {tooltip.hotspot.helpBody && <div className="dashboard-help-body">{tooltip.hotspot.helpBody}</div>}
            {tooltip.hotspot.helpCaveat && <div className="dashboard-help-caveat">{tooltip.hotspot.helpCaveat}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
