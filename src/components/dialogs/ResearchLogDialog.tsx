import { useState, useEffect, useRef } from 'react';
import { X, Book, Keyboard, CalendarPlus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ResearchLogCommentSectionId, ResearchLogMarkdownOptions, ResearchLogSectionId } from '../../types';
import { formatDateDisplay } from '../../lib/data';

export type ResearchLogGeneratedSectionId = Exclude<ResearchLogSectionId, 'overview' | 'diary' | 'exportPreview'>;

export type ResearchLogSnapshotIndexItem = {
  id: string;
  label: string;
  summary: string;
  stale: boolean;
  calculatedAt?: string;
  rowCount: number;
};

export interface ResearchLogDialogProps {
  isOpen: boolean;
  onClose: () => void;
  overview: string;
  onUpdateOverview: (value: string) => void;
  diary: string;
  onUpdateDiary: (value: string) => void;
  generatedSections: Record<ResearchLogGeneratedSectionId, string>;
  sectionComments: Partial<Record<ResearchLogCommentSectionId, string>>;
  onUpdateSectionComment: (sectionId: ResearchLogCommentSectionId, value: string) => void;
  markdownPreview: string;
  markdownOptions: ResearchLogMarkdownOptions;
  onMarkdownOptionsChange: (next: ResearchLogMarkdownOptions) => void;
  dashboardSnapshotsStale: boolean;
  onRecalculateSnapshots: () => void;
  onOpenDatasetDashboard: () => void;
  onOpenKeyboardHelp: () => void;
  onInsertDiaryDate: () => void;
  dashboardSnapshotIndex: ResearchLogSnapshotIndexItem[];
  currentProjectName: string;
  onRenameProject: (value: string) => void;
}

export const RESEARCH_LOG_SECTIONS: Array<{ id: ResearchLogSectionId; label: string; generated: boolean }> = [
  { id: 'overview', label: 'Overview', generated: false },
  { id: 'diary', label: 'Diary', generated: false },
  { id: 'corpusProcessing', label: 'Corpus & Processing', generated: true },
  { id: 'views', label: 'Saved Views', generated: true },
  { id: 'watchHistory', label: 'Watch History', generated: true },
  { id: 'researchActions', label: 'Research Actions', generated: true },
  { id: 'notesAppendix', label: 'Notes Appendix', generated: true },
  { id: 'dashboard', label: 'Dashboard', generated: true },
  { id: 'exportPreview', label: 'Export Preview', generated: true },
];

export function renderGeneratedSectionBody(value: string) {
  const text = value.trim() || 'No entries recorded';
  return (
    <pre className="custom-scrollbar whitespace-pre-wrap break-words border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 font-mono text-[12px] leading-6 text-[var(--text-main)]">
      {text}
    </pre>
  );
}

export function GeneratedSectionComment({
  sectionId,
  value,
  onChange,
}: {
  sectionId: ResearchLogCommentSectionId;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-[var(--border-color)] bg-[var(--bg-primary)]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="w-full border-b border-[var(--border-color)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-main)] hover:bg-[var(--grid-hover)]"
      >
        {open ? 'Hide' : 'Add'} researcher comment
      </button>
      {open && (
        <div className="p-3">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={`Optional researcher comment for ${sectionId}`}
            className="custom-scrollbar h-28 w-full resize-none border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}

export function ResearchLogDialog({
  isOpen,
  onClose,
  overview,
  onUpdateOverview,
  diary,
  onUpdateDiary,
  generatedSections,
  sectionComments,
  onUpdateSectionComment,
  markdownPreview,
  markdownOptions,
  onMarkdownOptionsChange,
  dashboardSnapshotsStale,
  onRecalculateSnapshots,
  onOpenDatasetDashboard,
  onOpenKeyboardHelp,
  onInsertDiaryDate,
  dashboardSnapshotIndex,
  currentProjectName,
  onRenameProject,
}: ResearchLogDialogProps) {
  const [activeSection, setActiveSection] = useState<ResearchLogSectionId>('diary');
  const [projectNameDraft, setProjectNameDraft] = useState(currentProjectName || 'ytde_project');
  const diaryTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleInsertDiaryDateClick = () => {
    onInsertDiaryDate();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const textarea = diaryTextareaRef.current;
        if (!textarea) return;
        const cursorPosition = textarea.value.length;
        textarea.focus();
        textarea.setSelectionRange(cursorPosition, cursorPosition);
        textarea.scrollTop = textarea.scrollHeight;
      });
    });
  };

  useEffect(() => {
    if (isOpen) setActiveSection('diary');
  }, [isOpen]);

  useEffect(() => {
    setProjectNameDraft(currentProjectName || 'ytde_project');
  }, [currentProjectName, isOpen]);

  if (!isOpen) return null;

  const showGeneratedComment = (sectionId: ResearchLogSectionId): sectionId is ResearchLogCommentSectionId =>
    sectionId !== 'overview' && sectionId !== 'diary';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="dialog-shell relative flex h-[88vh] w-full max-w-7xl flex-col overflow-hidden border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3">
          <h3 className="flex items-center gap-2 font-bold text-[var(--text-main)]"><Book size={18} className="text-[var(--accent)]" /> Research Log</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)]"><X size={20} /></button>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="custom-scrollbar w-64 flex-shrink-0 overflow-y-auto border-r border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Sections</div>
            <div className="space-y-1">
              {RESEARCH_LOG_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    'w-full border px-3 py-2 text-left text-xs transition-colors',
                    activeSection === section.id
                      ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] text-[var(--text-main)]'
                      : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:bg-[var(--grid-hover)] hover:text-[var(--text-main)]',
                  )}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </aside>

          <section className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-[var(--bg-secondary)] p-4">
            {activeSection === 'overview' && (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_280px] md:items-end">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-main)]">Project Overview</div>
                    <div className="mt-1 text-[11px] text-[var(--text-muted)]">The project name is used across the app except where the UI is explicitly referring to the original source CSV.</div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Project name</label>
                    <input
                      type="text"
                      value={projectNameDraft}
                      onChange={(event) => setProjectNameDraft(event.target.value)}
                      onBlur={() => onRenameProject(projectNameDraft.trim() || currentProjectName || 'ytde_project')}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          onRenameProject(projectNameDraft.trim() || currentProjectName || 'ytde_project');
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setProjectNameDraft(currentProjectName || 'ytde_project');
                        }
                      }}
                      className="w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none"
                    />
                  </div>
                </div>
                <textarea
                  value={overview}
                  onChange={(event) => onUpdateOverview(event.target.value)}
                  placeholder={'What is this project about?\nWhat corpus does it contain?\nWhat is the main research question?\nWhy was this material collected?\nWhat are key methodological choices or limitations?\nWhat does this log help document?'}
                  className="custom-scrollbar h-[66vh] w-full resize-none border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3 font-mono text-[13px] leading-6 text-[var(--text-main)] focus:outline-none"
                />
              </div>
            )}

            {activeSection === 'diary' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[var(--text-main)]">Research Diary</div>
                  <button
                    type="button"
                    onClick={() => {
                      onInsertDiaryDate();
                      window.requestAnimationFrame(() => {
                        const textarea = diaryTextareaRef.current;
                        if (!textarea) return;
                        textarea.focus();
                        const nextPosition = textarea.value.length;
                        textarea.setSelectionRange(nextPosition, nextPosition);
                      });
                    }}
                    className="inline-flex items-center gap-1 border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-main)]"
                    title="Insert today's date heading"
                  >
                    <CalendarPlus size={14} /> Add date
                  </button>
                </div>
                <textarea
                  ref={diaryTextareaRef}
                  value={diary}
                  onChange={(event) => onUpdateDiary(event.target.value)}
                  placeholder="Freeform observations, interpretations, anomalies, and decisions..."
                  className="custom-scrollbar h-[66vh] w-full resize-none border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3 font-mono text-[13px] leading-6 text-[var(--text-main)] focus:outline-none"
                />
              </div>
            )}

            {activeSection === 'dashboard' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={onRecalculateSnapshots} className={cn('border px-3 py-1.5 text-xs font-medium', dashboardSnapshotsStale ? 'border-[var(--accent)] text-[var(--text-main)]' : 'border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-main)]')}>
                    Recalculate snapshots
                  </button>
                  <button type="button" onClick={onOpenDatasetDashboard} className="border border-[var(--border-color)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)]">
                    Open Dataset Dashboard
                  </button>
                  {dashboardSnapshotsStale && <span className="text-xs font-medium text-[var(--accent)]">One or more snapshots are stale</span>}
                </div>

                <div className="space-y-2">
                  {dashboardSnapshotIndex.length === 0 ? (
                    <div className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-muted)]">No entries recorded</div>
                  ) : (
                    dashboardSnapshotIndex.map((item) => (
                      <div key={item.id} className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="font-semibold text-[var(--text-main)]">{item.label}</div>
                          <div className={cn('font-semibold', item.stale ? 'text-[var(--accent)]' : 'text-emerald-400')}>{item.stale ? 'Stale' : 'Fresh'}</div>
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--text-muted)]">Rows: {item.rowCount.toLocaleString()} • Calculated: {item.calculatedAt ? formatDateDisplay(item.calculatedAt) : 'n/a'}</div>
                        <div className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-[var(--text-main)]">{item.summary || 'No entries recorded'}</div>
                      </div>
                    ))
                  )}
                </div>

                {renderGeneratedSectionBody(generatedSections.dashboard)}
                <GeneratedSectionComment sectionId="dashboard" value={sectionComments.dashboard || ''} onChange={(value) => onUpdateSectionComment('dashboard', value)} />
              </div>
            )}

            {activeSection === 'exportPreview' && (
              <div className="space-y-4">
                <div className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Export preview options</div>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-xs text-[var(--text-main)]">
                      <input
                        type="checkbox"
                        checked={markdownOptions.includeNotesAppendix}
                        onChange={(event) => onMarkdownOptionsChange({ ...markdownOptions, includeNotesAppendix: event.target.checked })}
                      />
                      Include Notes Appendix
                    </label>
                    <label className="flex items-center gap-2 text-xs text-[var(--text-main)]">
                      <input
                        type="checkbox"
                        checked={markdownOptions.includeDashboardSection}
                        onChange={(event) => onMarkdownOptionsChange({ ...markdownOptions, includeDashboardSection: event.target.checked })}
                      />
                      Include Dashboard section
                    </label>
                  </div>
                </div>
                {dashboardSnapshotsStale && (
                  <div className="border border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_8%,transparent)] p-3 text-xs text-[var(--text-main)]">
                    Dashboard snapshots are stale for export. Recalculate snapshots before exporting if you need current dashboard values.
                    <div className="mt-2">
                      <button type="button" onClick={onRecalculateSnapshots} className="border border-[var(--accent)] px-3 py-1 text-xs font-medium hover:bg-[var(--grid-hover)]">
                        Recalculate snapshots
                      </button>
                    </div>
                  </div>
                )}
                <pre className="custom-scrollbar max-h-[58vh] overflow-auto whitespace-pre-wrap border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 font-mono text-[12px] leading-6 text-[var(--text-main)]">
                  {markdownPreview}
                </pre>
                <GeneratedSectionComment sectionId="exportPreview" value={sectionComments.exportPreview || ''} onChange={(value) => onUpdateSectionComment('exportPreview', value)} />
              </div>
            )}

            {activeSection !== 'overview' && activeSection !== 'diary' && activeSection !== 'dashboard' && activeSection !== 'exportPreview' && (
              <div className="space-y-4">
                {renderGeneratedSectionBody(generatedSections[activeSection])}
                {showGeneratedComment(activeSection) && (
                  <GeneratedSectionComment
                    sectionId={activeSection}
                    value={sectionComments[activeSection] || ''}
                    onChange={(value) => onUpdateSectionComment(activeSection, value)}
                  />
                )}
              </div>
            )}
          </section>
        </div>

        <button
          type="button"
          onClick={onOpenKeyboardHelp}
          className="absolute bottom-3 left-3 inline-flex h-8 w-8 items-center justify-center border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-muted)] transition-colors hover:bg-[var(--grid-hover)] hover:text-[var(--text-main)]"
          title="Keyboard shortcuts"
          aria-label="Open keyboard shortcuts help"
        >
          <Keyboard size={14} />
        </button>
      </div>
    </div>
  );
}
