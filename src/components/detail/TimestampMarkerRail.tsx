import { Trash2 } from 'lucide-react';

export function TimestampMarkerRail({
  markers,
  durationSeconds,
  onDeleteMarker,
  onSeekMarker,
}: {
  markers: Array<{ id: string; time_seconds: number; time_label: string; preview: string }>;
  durationSeconds: number;
  onDeleteMarker: (markerId: string) => void;
  /** Jumps the player to the marker's time. */
  onSeekMarker?: (seconds: number) => void;
}) {
  const safeDuration = Math.max(1, Math.floor(durationSeconds || 0));
  return (
    <div className="border-t border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
      <div className="relative overflow-visible px-1 py-1">
        <div className="relative h-4">
          <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-[var(--border-color)]" />
          {markers.map((marker) => {
            const position = Math.min(100, Math.max(0, (marker.time_seconds / safeDuration) * 100));
            return (
              <div
                key={marker.id}
                className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${position}%` }}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    onSeekMarker?.(marker.time_seconds);
                  }}
                  className="h-3 w-3 rounded-full border border-[var(--accent)] bg-[var(--accent)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  aria-label={`Timestamp ${marker.time_label}`}
                  title={`Play from ${marker.time_label}`}
                />
                <div className="absolute bottom-[calc(100%+8px)] left-1/2 z-20 hidden w-56 -translate-x-1/2 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] p-2 shadow-xl group-hover:block group-focus-within:block">
                  <div className="text-[11px] font-semibold text-[var(--text-main)]">{marker.time_label}</div>
                  <div className="mt-1 line-clamp-3 text-[11px] text-[var(--text-muted)]">{marker.preview}</div>
                  <button
                    type="button"
                    onClick={() => onDeleteMarker(marker.id)}
                    className="mt-2 inline-flex items-center gap-1 border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-[11px] text-[var(--text-main)] hover:border-red-500 hover:text-red-600"
                    aria-label={`Delete timestamp ${marker.time_label}`}
                    title={`Delete timestamp ${marker.time_label}`}
                  >
                    <Trash2 size={11} />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
