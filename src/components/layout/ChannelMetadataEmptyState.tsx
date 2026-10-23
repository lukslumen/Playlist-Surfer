/** Shown in the channels view until channel metadata has been generated from the video list. */
export function ChannelMetadataEmptyState({ isGenerating, onGenerate }: { isGenerating: boolean; onGenerate: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 text-center shadow-sm">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Channels view</div>
        <div className="mt-2 text-lg font-semibold text-[var(--text-main)]">Channel metadata hasn’t been generated yet</div>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">Generate channel-level metadata from the current video list to switch into the channels table.</p>
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating}
            className="border border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] px-4 py-2 text-sm font-medium text-[var(--text-main)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] disabled:opacity-50"
          >
            {isGenerating ? 'Generating...' : 'Generate channel metadata'}
          </button>
        </div>
      </div>
    </div>
  );
}
