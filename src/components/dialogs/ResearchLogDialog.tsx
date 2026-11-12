import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { BarChart3, Book, ChevronDown, ChevronRight, Copy, Database, Download, Eye, MessageSquarePlus, Pencil, StickyNote, Trash2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ResearchHistoryEvent, ResearchLogMarkdownOptions } from '../../types';
import { groupByDay, netTimeline, rawTimeline, type TimelineCategory, type TimelineEntry } from '../../lib/researchLogTimeline';
import type { VideoLabel } from '../../lib/researchLogExport';
import { useToast } from '../toast/ToastProvider';

export interface WatchSummaryItem {
  videoId: string;
  title: string;
  channel: string;
  /** Unique seconds played: each part of the video once. */
  coveredSeconds: number;
  /** All playback time, replays included. */
  totalSeconds: number;
  durationSeconds: number | null;
  lastWatchedAt: string;
}

export interface ResearchLogDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentProjectName: string;
  onRenameProject: (value: string) => void;
  overview: string;
  onUpdateOverview: (value: string) => void;
  events: ResearchHistoryEvent[];
  onAddNote: (text: string) => void;
  /** Edits a note entry's text, or the note attached to an action. Empty text removes an attached note. */
  onSetNote: (eventId: string, text: string) => void;
  onDeleteNote: (eventId: string) => void;
  describeVideo: (videoId: string) => VideoLabel | null;
  onOpenVideo: (videoId: string) => void;
  watch: WatchSummaryItem[];
  markdownOptions: ResearchLogMarkdownOptions;
  onMarkdownOptionsChange: (next: ResearchLogMarkdownOptions) => void;
  buildMarkdown: () => string;
  dashboardsStale: boolean;
}

type Tab = 'project' | 'timeline' | 'export';
type Filter = 'all' | TimelineCategory;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'note', label: 'My notes' },
  { value: 'data', label: 'Data changes' },
  { value: 'views', label: 'Views' },
  { value: 'analysis', label: 'Analysis' },
];

const CATEGORY_ICON: Record<TimelineCategory, typeof StickyNote> = { note: StickyNote, data: Database, views: Eye, analysis: BarChart3 };

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours) return `${hours} h ${minutes} min`;
  if (minutes) return `${minutes} min${rest ? ` ${rest} s` : ''}`;
  return `${rest} s`;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function NoteEditor({ initial, placeholder, onSave, onCancel, submitLabel }: {
  initial: string;
  placeholder: string;
  onSave: (text: string) => void;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(240, node.scrollHeight)}px`;
  }, [draft]);
  const submit = () => {
    if (!draft.trim() && !onCancel) return;
    onSave(draft.trim());
    if (!onCancel) setDraft('');
  };
  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
    if (event.key === 'Escape' && onCancel) {
      event.stopPropagation();
      onCancel();
    }
  };
  return (
    <div className="flex items-end gap-2">
      <textarea
        ref={ref}
        rows={1}
        autoFocus={Boolean(onCancel)}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        className="min-h-[38px] flex-1 resize-none rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] leading-5 text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        aria-label={placeholder}
      />
      {onCancel ? <button type="button" onClick={onCancel} className="rlog-button is-quiet">Cancel</button> : null}
      <button type="button" onClick={submit} disabled={!draft.trim() && !onCancel} className="rlog-button">{submitLabel}</button>
    </div>
  );
}

interface TimelineItemProps {
  entry: TimelineEntry;
  describeVideo: (videoId: string) => VideoLabel | null;
  onOpenVideo: (videoId: string) => void;
  onSetNote: (eventId: string, text: string) => void;
  onDeleteNote: (eventId: string) => void;
  showSteps: boolean;
}

function TimelineItem({ entry, describeVideo, onOpenVideo, onSetNote, onDeleteNote, showSteps }: TimelineItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const Icon = CATEGORY_ICON[entry.category];
  const isOwnNote = entry.category === 'note' && entry.title === entry.note;
  const canExpand = entry.details.length > 0 || entry.videoIds.length > 0;

  if (isOwnNote) {
    return (
      <li className="rlog-item is-note">
        <span className="rlog-time">{timeOf(entry.createdAt)}</span>
        <Icon size={14} className="rlog-icon" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {editing ? (
            <NoteEditor initial={entry.note ?? ''} placeholder="Edit note" submitLabel="Save" onCancel={() => setEditing(false)} onSave={(text) => { onSetNote(entry.id, text); setEditing(false); }} />
          ) : (
            <p className="whitespace-pre-wrap text-[13px] leading-5 text-[var(--text-main)]">{entry.note}</p>
          )}
        </div>
        {!editing ? (
          <div className="rlog-actions">
            <button type="button" onClick={() => setEditing(true)} aria-label="Edit note" title="Edit"><Pencil size={13} /></button>
            <button type="button" onClick={() => onDeleteNote(entry.id)} aria-label="Delete note" title="Delete"><Trash2 size={13} /></button>
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <li className="rlog-item">
      <span className="rlog-time">{timeOf(entry.createdAt)}</span>
      <Icon size={14} className="rlog-icon" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <button type="button" className="rlog-title" onClick={() => canExpand && setExpanded((value) => !value)} aria-expanded={canExpand ? expanded : undefined} disabled={!canExpand}>
          {canExpand ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
          <span>{entry.title}</span>
          {!showSteps && entry.mergedSteps > 1 ? <span className="rlog-merged" title="Earlier steps on the same thing were folded into this entry">{entry.mergedSteps} steps</span> : null}
        </button>
        {expanded ? (
          <div className="rlog-detail">
            {entry.details.map((line) => <p key={line}>{line}</p>)}
            {entry.videoIds.length ? (
              <ul>
                {entry.videoIds.slice(0, 50).map((videoId) => {
                  const video = describeVideo(videoId);
                  return (
                    <li key={videoId}>
                      <button type="button" onClick={() => onOpenVideo(videoId)} className="rlog-video">
                        {video ? <>{video.title} <span className="text-[var(--text-muted)]">· {video.channel}</span></> : videoId}
                      </button>
                    </li>
                  );
                })}
                {entry.videoIds.length > 50 ? <li className="text-[var(--text-muted)]">and {(entry.videoIds.length - 50).toLocaleString()} more</li> : null}
              </ul>
            ) : null}
          </div>
        ) : null}
        {editing ? (
          <div className="mt-2">
            <NoteEditor initial={entry.note ?? ''} placeholder="Why? Add a note to this step" submitLabel="Save" onCancel={() => setEditing(false)} onSave={(text) => { onSetNote(entry.id, text); setEditing(false); }} />
          </div>
        ) : entry.note ? (
          <p className="rlog-attached" onDoubleClick={() => setEditing(true)}>↳ {entry.note}</p>
        ) : null}
      </div>
      {!editing ? (
        <div className="rlog-actions">
          <button type="button" onClick={() => setEditing(true)} aria-label={entry.note ? 'Edit note on this step' : 'Add a note to this step'} title={entry.note ? 'Edit note' : 'Add a note'}>
            {entry.note ? <Pencil size={13} /> : <MessageSquarePlus size={13} />}
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function ResearchLogDialog(props: ResearchLogDialogProps) {
  const { isOpen, onClose, events, watch } = props;
  const [tab, setTab] = useState<Tab>('timeline');
  const [filter, setFilter] = useState<Filter>('all');
  const [showSteps, setShowSteps] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState(props.currentProjectName);
  const { showToast } = useToast();

  useEffect(() => {
    setProjectNameDraft(props.currentProjectName);
  }, [props.currentProjectName, isOpen]);

  const entries = useMemo(() => (showSteps ? rawTimeline(events) : netTimeline(events)), [events, showSteps]);
  const filtered = useMemo(() => (filter === 'all' ? entries : entries.filter((entry) => entry.category === filter)), [entries, filter]);
  const groups = useMemo(() => groupByDay(filtered), [filtered]);
  const hiddenSteps = useMemo(() => rawTimeline(events).length - netTimeline(events).length, [events]);
  const markdown = useMemo(() => (tab === 'export' ? props.buildMarkdown() : ''), [props, tab]);

  if (!isOpen) return null;

  const watchCovered = watch.reduce((total, item) => total + item.coveredSeconds, 0);
  const watchTotal = watch.reduce((total, item) => total + item.totalSeconds, 0);

  const download = () => {
    const blob = new Blob([props.buildMarkdown()], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(props.currentProjectName || 'research-log').replace(/[^\w.-]+/g, '_')}_research_log.md`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.buildMarkdown());
      showToast({ kind: 'success', message: 'Research log copied' });
    } catch {
      showToast({ kind: 'error', message: "Couldn't copy to the clipboard" });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="rlog dialog-shell relative flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-label="Research log">
        <div className="flex items-center gap-4 border-b border-[var(--border-color)] px-5 py-3">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--text-main)]"><Book size={17} className="text-[var(--accent)]" /> Research log</h3>
          <div className="rlog-tabs" role="tablist" aria-label="Research log sections">
            {([['project', 'Project'], ['timeline', 'Timeline'], ['export', 'Export']] as const).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} className={cn(tab === value && 'is-active')} onClick={() => setTab(value)}>{label}</button>
            ))}
          </div>
          <button type="button" onClick={onClose} className="ml-auto text-[var(--text-muted)] hover:text-[var(--text-main)]" aria-label="Close research log"><X size={19} /></button>
        </div>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {tab === 'project' ? (
            <div className="space-y-6">
              <label className="block">
                <span className="rlog-label">Project name</span>
                <input
                  value={projectNameDraft}
                  onChange={(event) => setProjectNameDraft(event.target.value)}
                  onBlur={() => projectNameDraft.trim() && projectNameDraft !== props.currentProjectName && props.onRenameProject(projectNameDraft.trim())}
                  className="rlog-input"
                />
              </label>
              <label className="block">
                <span className="rlog-label">Research question and notes</span>
                <textarea
                  value={props.overview}
                  onChange={(event) => props.onUpdateOverview(event.target.value)}
                  placeholder={'What is the research question?\nWhy this corpus, and how was it collected?\nKey decisions and limitations.'}
                  className="rlog-input min-h-[11rem] leading-6"
                />
              </label>
              <section>
                <div className="flex items-baseline justify-between">
                  <span className="rlog-label">What you've watched</span>
                  {watch.length ? (
                    <span className="text-[12px] text-[var(--text-muted)]">{watch.length.toLocaleString()} {watch.length === 1 ? 'video' : 'videos'} · <span title="Each part of a video counts once, however often it was replayed">{formatDuration(watchCovered)} watched</span> · <span title="All playback, replays included">{formatDuration(watchTotal)} total playback</span></span>
                  ) : null}
                </div>
                {watch.length ? (
                  <ul className="rlog-watch">
                    {watch.map((item) => {
                      const share = item.durationSeconds ? Math.min(1, item.coveredSeconds / item.durationSeconds) : null;
                      return (
                        <li key={item.videoId}>
                          <button type="button" onClick={() => props.onOpenVideo(item.videoId)} className="min-w-0 flex-1 text-left">
                            <span className="block truncate text-[13px] text-[var(--text-main)]">{item.title}</span>
                            <span className="block truncate text-[11.5px] text-[var(--text-muted)]">{item.channel}</span>
                          </button>
                          <span className="rlog-meter" title={share === null ? undefined : `${Math.round(share * 100)}% of the video`}>
                            <span style={{ width: `${(share ?? 0) * 100}%` }} />
                          </span>
                          <span className="w-36 shrink-0 text-right text-[12px] text-[var(--text-muted)]">
                            {formatDuration(item.coveredSeconds)}{item.durationSeconds ? ` of ${formatDuration(item.durationSeconds)}` : ''}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-2 text-[13px] text-[var(--text-muted)]">Nothing watched yet. Time you play videos in the detail panel shows up here; replayed parts count once.</p>
                )}
              </section>
            </div>
          ) : null}

          {tab === 'timeline' ? (
            <div className="space-y-4">
              <NoteEditor initial="" placeholder="Write a note… (Enter to add, Shift+Enter for a new line)" submitLabel="Add" onSave={props.onAddNote} />
              <div className="flex flex-wrap items-center gap-2">
                <div className="rlog-filters" role="group" aria-label="Show">
                  {FILTERS.map((option) => (
                    <button key={option.value} type="button" aria-pressed={filter === option.value} className={cn(filter === option.value && 'is-active')} onClick={() => setFilter(option.value)}>{option.label}</button>
                  ))}
                </div>
                <label className="ml-auto flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]" title="Show every recorded step, including undone and superseded ones">
                  <input type="checkbox" checked={showSteps} onChange={(event) => setShowSteps(event.target.checked)} />
                  Show all steps{!showSteps && hiddenSteps > 0 ? ` (${hiddenSteps.toLocaleString()} folded away)` : ''}
                </label>
              </div>
              {groups.length ? groups.map((group) => (
                <section key={group.key}>
                  <h4 className="rlog-day">{group.label}</h4>
                  <ul className="rlog-list">
                    {group.entries.map((entry) => (
                      <Fragment key={entry.id}><TimelineItem entry={entry} describeVideo={props.describeVideo} onOpenVideo={props.onOpenVideo} onSetNote={props.onSetNote} onDeleteNote={props.onDeleteNote} showSteps={showSteps} /></Fragment>
                    ))}
                  </ul>
                </section>
              )) : (
                <p className="py-10 text-center text-[13px] text-[var(--text-muted)]">{filter === 'all' ? 'Nothing recorded yet. Imports, exclusions, saved views and analyses appear here, next to your notes.' : 'Nothing of this kind yet.'}</p>
              )}
            </div>
          ) : null}

          {tab === 'export' ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-main)]">
                  <input type="checkbox" checked={props.markdownOptions.includeDashboardSection} onChange={(event) => props.onMarkdownOptionsChange({ ...props.markdownOptions, includeDashboardSection: event.target.checked })} />
                  Dashboard write-ups{props.dashboardsStale ? <span className="text-[var(--text-muted)]"> (some out of date)</span> : null}
                </label>
                <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-main)]">
                  <input type="checkbox" checked={props.markdownOptions.includeNotesAppendix} onChange={(event) => props.onMarkdownOptionsChange({ ...props.markdownOptions, includeNotesAppendix: event.target.checked })} />
                  Notes by video
                </label>
                <div className="ml-auto flex gap-2">
                  <button type="button" className="rlog-button is-quiet" onClick={() => void copy()}><Copy size={13} /> Copy</button>
                  <button type="button" className="rlog-button" onClick={download}><Download size={13} /> Download .md</button>
                </div>
              </div>
              <pre className="rlog-preview" aria-label="Export preview">{markdown}</pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
