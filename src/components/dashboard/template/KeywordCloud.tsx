import type { DashboardTemplateCountStat } from '../../../lib/dashboardTemplateTypes';
import { InfoProps, MetricHeader } from './InfoPopover';
import { formatPercent } from './format';

type KeywordCloudProps = {
  title: string;
  items: DashboardTemplateCountStat[];
  tone?: 'video' | 'channel' | 'engagement';
  info: InfoProps;
};

type CloudWord = {
  label: string;
  count: number;
  share: number;
  size: number;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotate: number;
  isCore: boolean;
};

type WordRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const CLOUD_WIDTH = 980;

const CLOUD_HEIGHT = 236;

function estimateWordBox(label: string, size: number): { width: number; height: number } {
  const rawWidth = label.length * size * 0.62 + size * 1.8;
  const width = Math.max(size * 2.6, Math.min(rawWidth, CLOUD_WIDTH * 0.56));
  return {
    width,
    height: size * 1.18,
  };
}

function intersects(a: WordRect, b: WordRect, pad = 5): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width + pad * 2
    && Math.abs(a.y - b.y) * 2 < a.height + b.height + pad * 2
  );
}

function insideEllipse(rect: WordRect): boolean {
  const cx = CLOUD_WIDTH / 2;
  const cy = CLOUD_HEIGHT / 2;
  const rx = CLOUD_WIDTH * 0.49 - rect.width / 2;
  const ry = CLOUD_HEIGHT * 0.46 - rect.height / 2;
  if (rx <= 0 || ry <= 0) return false;
  const dx = (rect.x - cx) / rx;
  const dy = (rect.y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function buildCloudWords(items: DashboardTemplateCountStat[]): CloudWord[] {
  const sorted = [...items].sort((a, b) => b.share - a.share);
  if (!sorted.length) return [];

  const placedRects: WordRect[] = [];
  const placedWords: CloudWord[] = [];
  const centerX = CLOUD_WIDTH / 2;
  const centerY = CLOUD_HEIGHT / 2;
  const ringSteps = [0.2, 0.34, 0.48, 0.6, 0.72, 0.82, 0.9];

  const core = sorted[0];
  const coreSize = 31;
  const coreBox = estimateWordBox(core.label, coreSize);
  const coreRect: WordRect = { x: centerX, y: centerY, width: coreBox.width, height: coreBox.height };
  placedRects.push(coreRect);
  placedWords.push({
    ...core,
    size: coreSize,
    opacity: 0.96,
    x: centerX,
    y: centerY,
    width: coreBox.width,
    height: coreBox.height,
    rotate: 0,
    isCore: true,
  });

  const maxWords = Math.min(sorted.length, 42);
  for (let i = 1; i < maxWords; i += 1) {
    const item = sorted[i];
    const baseSize = Math.max(10, 20 - Math.floor(i / 3));
    let placed = false;

    for (let shrink = 0; shrink < 5 && !placed; shrink += 1) {
      const size = Math.max(10, baseSize - shrink);
      const box = estimateWordBox(item.label, size);

      for (let ringIndex = 0; ringIndex < ringSteps.length && !placed; ringIndex += 1) {
        const ring = ringSteps[ringIndex];
        const radiusX = (CLOUD_WIDTH * 0.46) * ring;
        const radiusY = (CLOUD_HEIGHT * 0.42) * ring;
        const circumference = 2 * Math.PI * Math.max(radiusX, radiusY);
        const slots = Math.max(8, Math.round(circumference / Math.max(box.width * 0.9, 68)));

        for (let slot = 0; slot < slots && !placed; slot += 1) {
          const angle = ((slot / slots) * Math.PI * 2) + (ringIndex * 0.24) + (i * 0.17);
          const x = centerX + Math.cos(angle) * radiusX;
          const y = centerY + Math.sin(angle) * radiusY;
          const rect: WordRect = { x, y, width: box.width, height: box.height };
          const pad = i < 7 ? 8 : i < 18 ? 6 : 4;

          if (!insideEllipse(rect)) continue;
          if (placedRects.some((existing) => intersects(rect, existing, pad))) continue;

          placedRects.push(rect);
          placedWords.push({
            ...item,
            size,
            opacity: Math.max(0.48, 0.84 - (i * 0.015)),
            x,
            y,
            width: box.width,
            height: box.height,
            rotate: 0,
            isCore: false,
          });
          placed = true;
        }
      }
    }
  }

  return placedWords;
}

export function KeywordCloud({ title, items, tone = 'video', info }: KeywordCloudProps) {
  const words = buildCloudWords(items);
  return (
    <div className="keyword-cloud-block">
      <MetricHeader title={title} info={info} />
      <div className={`keyword-cloud-safe tone-${tone}`}>
        {words.map((word, index) => (
          <span
            key={`${title}-${word.label}-${index}`}
            className={`cloud-word tone-${tone} ${word.isCore ? 'is-core' : ''}`}
            style={{
              fontSize: `${word.isCore ? word.size : Math.max(9, word.size - 0.5)}px`,
              opacity: word.opacity,
              left: `${(word.x / CLOUD_WIDTH) * 100}%`,
              top: `${(word.y / CLOUD_HEIGHT) * 100}%`,
              width: `${(word.width / CLOUD_WIDTH) * 100}%`,
              maxWidth: `${(word.width / CLOUD_WIDTH) * 100}%`,
              transform: `translate(-50%, -50%) rotate(${word.rotate}deg)`,
            }}
            title={`${word.label}: ${word.count} videos (${formatPercent(word.share, 1)})`}
          >
            {word.label}
          </span>
        ))}
      </div>
    </div>
  );
}
