import { useState, useEffect } from 'react';
import { X, Download, FileArchive, FileText, TableProperties } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ColumnSchema, ExportFormat, ExportOptions, ResearchLogMarkdownOptions } from '../../types';
import { getColumnDisplayName } from '../../lib/data';
import { formatColumnOptionLabel } from './shared';

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  columns: ColumnSchema[];
  onExport: (options: ExportOptions) => void;
  rowCount: number;
  totalRowCount: number;
  hasProjectNotes: boolean;
  hasUserTags: boolean;
  currentProjectName: string;
  markdownOptions: ResearchLogMarkdownOptions;
  onMarkdownOptionsChange: (options: ResearchLogMarkdownOptions) => void;
  dashboardSnapshotsStale: boolean;
  onRecalculateSnapshots: () => void;
}

export function ExportDialog({
  isOpen,
  onClose,
  columns,
  onExport,
  rowCount,
  totalRowCount,
  hasProjectNotes,
  hasUserTags,
  currentProjectName,
  markdownOptions,
  onMarkdownOptionsChange,
  dashboardSnapshotsStale,
  onRecalculateSnapshots,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [selectedColumns, setSelectedColumns] = useState<string[]>(columns.map((column) => column.column_name));
  const [includeFilteredRows, setIncludeFilteredRows] = useState(true);
  const [includeNotesColumn, setIncludeNotesColumn] = useState(true);
  const [includeUserTagsColumn, setIncludeUserTagsColumn] = useState(true);
  const [projectName, setProjectName] = useState(currentProjectName || 'ytde_project');

  useEffect(() => {
    if (isOpen) {
      setSelectedColumns(columns.map((column) => column.column_name));
      setProjectName(currentProjectName || 'ytde_project');
    }
  }, [columns, currentProjectName, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="dialog-shell flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-4">
          <h3 className="flex items-center gap-2 font-bold text-[var(--text-main)]"><Download size={18} className="text-[var(--accent)]" /> Export Project</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)]"><X size={20} /></button>
        </div>
        <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-4">
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { id: 'csv', title: 'CSV data export', description: 'Download a CSV with the columns you choose.', icon: TableProperties },
              { id: 'markdown', title: 'Research Log markdown', description: 'Download the Research Log as markdown.', icon: FileText },
              { id: 'project', title: 'Full project backup', description: 'Download a restore-ready project zip.', icon: FileArchive },
            ].map((option) => {
              const Icon = option.icon;
              return (
                <button key={option.id} onClick={() => setFormat(option.id as ExportFormat)} className={cn('border px-4 py-4 text-left transition-colors', format === option.id ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]' : 'border-[var(--border-color)] bg-[var(--bg-primary)] hover:bg-[var(--grid-hover)]')}>
                  <Icon size={18} className="mb-3 text-[var(--accent)]" />
                  <div className="text-sm font-semibold text-[var(--text-main)]">{option.title}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">{option.description}</div>
                </button>
              );
            })}
          </div>

          {format === 'csv' && (
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.9fr]">
              <div className="border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Columns to include</div>
                  <div className="text-[11px] text-[var(--text-muted)]">{selectedColumns.length} selected</div>
                </div>
                <div className="custom-scrollbar grid max-h-[320px] grid-cols-2 gap-1 overflow-y-auto border border-[var(--border-color)] p-2">
                  {columns.map((column) => (
                    <label key={column.column_name} className="flex items-center gap-2 px-2 py-1.5 text-xs text-[var(--text-main)] hover:bg-[var(--bg-secondary)]">
                      <input type="checkbox" checked={selectedColumns.includes(column.column_name)} onChange={() => setSelectedColumns((current) => current.includes(column.column_name) ? current.filter((value) => value !== column.column_name) : [...current, column.column_name])} />
                      <span className="truncate" title={formatColumnOptionLabel(column.column_name, columns)}>{getColumnDisplayName(column)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-3 border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">CSV Options</div>
                <label className="flex items-start gap-3 text-sm text-[var(--text-main)]"><input type="checkbox" checked={includeFilteredRows} onChange={(e) => setIncludeFilteredRows(e.target.checked)} className="mt-0.5" /><span>Export only filtered rows<span className="mt-1 block text-[11px] text-[var(--text-muted)]">{includeFilteredRows ? `${rowCount.toLocaleString()} rows will be exported.` : `${totalRowCount.toLocaleString()} rows will be exported.`}</span></span></label>
                <label className="flex items-start gap-3 text-sm text-[var(--text-main)]"><input type="checkbox" checked={includeNotesColumn} onChange={(e) => setIncludeNotesColumn(e.target.checked)} className="mt-0.5" /><span>Add video notes column</span></label>
                <label className="flex items-start gap-3 text-sm text-[var(--text-main)]"><input type="checkbox" checked={includeUserTagsColumn} onChange={(e) => setIncludeUserTagsColumn(e.target.checked)} className="mt-0.5" /><span>Add user tags column<span className="mt-1 block text-[11px] text-[var(--text-muted)]">{hasUserTags ? 'Saved tags will be included.' : 'No saved tags yet.'}</span></span></label>
              </div>
            </div>
          )}

          {format === 'markdown' && (
            <div className="space-y-4 border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
              <div>
                <div className="text-sm font-semibold text-[var(--text-main)]">Research Log markdown</div>
                <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-muted)]">
                  This download contains a human-readable Research Log document. {hasProjectNotes ? 'Your current diary text will be included.' : 'The file will still be created even if the diary is currently empty.'}
                </p>
              </div>
              <div className="space-y-2 border-t border-[var(--border-color)] pt-4">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Markdown options</div>
                <label className="flex items-start gap-3 text-sm text-[var(--text-main)]">
                  <input
                    type="checkbox"
                    checked={markdownOptions.includeNotesAppendix}
                    onChange={(event) => onMarkdownOptionsChange({ ...markdownOptions, includeNotesAppendix: event.target.checked })}
                    className="mt-0.5"
                  />
                  <span>Include Notes Appendix</span>
                </label>
                <label className="flex items-start gap-3 text-sm text-[var(--text-main)]">
                  <input
                    type="checkbox"
                    checked={markdownOptions.includeDashboardSection}
                    onChange={(event) => onMarkdownOptionsChange({ ...markdownOptions, includeDashboardSection: event.target.checked })}
                    className="mt-0.5"
                  />
                  <span>Include Dashboard section</span>
                </label>
              </div>
              {dashboardSnapshotsStale && (
                <div className="border border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_8%,transparent)] p-3">
                  <div className="text-xs font-semibold text-[var(--text-main)]">Dashboard snapshots are stale</div>
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">Refresh snapshots before export if you want up-to-date dashboard summaries in markdown.</p>
                  <button type="button" onClick={onRecalculateSnapshots} className="mt-3 border border-[var(--accent)] px-3 py-1 text-xs font-medium text-[var(--text-main)] hover:bg-[var(--grid-hover)]">
                    Recalculate snapshots
                  </button>
                </div>
              )}
            </div>
          )}

          {format === 'project' && (
            <div className="space-y-4 border border-[var(--border-color)] bg-[var(--bg-primary)] p-5">
              <div className="space-y-3">
                <div className="text-sm font-semibold text-[var(--text-main)]">Full project backup</div>
                <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">This backup will include the full project dataset, deleted-column history, annotations, saved views, and the Research Log data in a restore-ready zip.</p>
              </div>
              <div className="space-y-2 border-t border-[var(--border-color)] pt-4">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Project name</label>
                <input type="text" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Project backup name" className="w-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none" />
                <p className="text-[11px] text-[var(--text-muted)]">This name will be used for the zip file and the folder inside the backup.</p>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-3 border-t border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <button onClick={onClose} className="flex-1 border border-[var(--border-color)] px-4 py-2 text-sm font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-secondary)]">Cancel</button>
          <button
            onClick={() => onExport({
              format,
              selectedColumns,
              includeFilteredRows,
              includeNotesColumn,
              includeUserTagsColumn,
              markdownOptions,
              projectName,
            })}
            disabled={format === 'csv' && selectedColumns.length === 0}
            className="flex-1 bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {format === 'csv' ? 'Download CSV' : format === 'markdown' ? 'Download Markdown' : 'Download Project Backup'}
          </button>
        </div>
      </div>
    </div>
  );
}
