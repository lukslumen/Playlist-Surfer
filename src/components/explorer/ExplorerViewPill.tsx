import { LayoutGrid, Minus, Plus, Table2 } from 'lucide-react';
import type { ExplorerLayout } from '../../types';
import { cn } from '../../lib/utils';
import { stepThumbnailTileWidth, THUMBNAIL_TILE_WIDTHS } from '../../lib/videoThumbnails';

/**
 * Floating control in the explorer's bottom-right corner: switch between the table and the
 * thumbnails, and, in the thumbnail view, change the tile size.
 */
export function ExplorerViewPill({ layout, onLayoutChange, tileWidth, onTileWidthChange }: {
  layout: ExplorerLayout;
  onLayoutChange: (layout: ExplorerLayout) => void;
  tileWidth: number;
  onTileWidthChange: (width: number) => void;
}) {
  const options = [
    { value: 'table' as const, icon: <Table2 size={14} />, label: 'Show videos as a table', title: 'Table (Alt/Option + Shift + T)' },
    { value: 'thumbnails' as const, icon: <LayoutGrid size={14} />, label: 'Show videos as thumbnails', title: 'Thumbnails (Alt/Option + Shift + T)' },
  ];
  return (
    <div className="explorer-view-pill" role="toolbar" aria-label="Videos view">
      <div className="explorer-view-pill-group" role="group" aria-label="Videos layout">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={cn(layout === option.value && 'is-active')}
            aria-pressed={layout === option.value}
            aria-label={option.label}
            title={option.title}
            onClick={() => onLayoutChange(option.value)}
          >
            {option.icon}
          </button>
        ))}
      </div>
      {layout === 'thumbnails' ? (
        <div className="explorer-view-pill-group" role="group" aria-label="Thumbnail size">
          <button
            type="button"
            onClick={() => onTileWidthChange(stepThumbnailTileWidth(tileWidth, -1))}
            disabled={tileWidth <= THUMBNAIL_TILE_WIDTHS[0]}
            title="Smaller thumbnails (Ctrl/Cmd −)"
            aria-label="Smaller thumbnails"
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            onClick={() => onTileWidthChange(stepThumbnailTileWidth(tileWidth, 1))}
            disabled={tileWidth >= THUMBNAIL_TILE_WIDTHS[THUMBNAIL_TILE_WIDTHS.length - 1]}
            title="Larger thumbnails (Ctrl/Cmd +)"
            aria-label="Larger thumbnails"
          >
            <Plus size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
