import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Check, Eraser, Search, X } from 'lucide-react';
import { CustomFilterProps, useGridFilter } from 'ag-grid-react';
import {
  parseListString,
  BooleanMapFilterModel,
  BooleanMapSchema,
  GenericFilterKind,
  GenericFilterModel,
  GenericNumericOperator,
  GenericTextOperator,
  TagFilterModel,
  normalizeGenericModel,
} from '../lib/filterCoordinator';

export { parseListString } from '../lib/filterCoordinator';

function closeFilter(props: CustomFilterProps<any, any, any>) {
  if (typeof props.api.hideColumnFilter === 'function') {
    props.api.hideColumnFilter();
  }
}

function IconActionButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex h-7 w-7 items-center justify-center border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-main)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
    >
      {children}
    </button>
  );
}

export function GenericValueFilter(props: CustomFilterProps<any, any, GenericFilterModel>) {
  const filterKind = (((props.colDef.filterParams as any)?.filterKind) || 'text') as GenericFilterKind;
  const normalizedModel = useMemo(() => normalizeGenericModel(props.model, filterKind), [props.model, filterKind]);
  const [draftOperator, setDraftOperator] = useState<GenericTextOperator | GenericNumericOperator>(filterKind === 'text' ? 'contains' : 'eq');
  const [draftValue, setDraftValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraftOperator(normalizedModel?.operator ?? (filterKind === 'text' ? 'contains' : 'eq'));
    setDraftValue(normalizedModel?.value ?? '');
  }, [normalizedModel, filterKind]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [filterKind]);

  const doesFilterPass = useCallback(() => true, []);
  useGridFilter({ doesFilterPass });

  const buildModel = (): GenericFilterModel | null => {
    if (!draftValue.trim()) return null;
    return {
      filterKind,
      operator: draftOperator,
      value: draftValue.trim(),
    };
  };

  const applyFilter = () => {
    props.onModelChange(buildModel());
    closeFilter(props);
  };

  const clearFilter = () => {
    setDraftValue('');
    setDraftOperator(filterKind === 'text' ? 'contains' : 'eq');
    props.onUiChange();
    props.onModelChange(null);
    closeFilter(props);
  };

  const operatorOptions = filterKind === 'text'
    ? [
        { value: 'contains', label: 'Contains' },
        { value: 'equals', label: 'Equals' },
        { value: 'startsWith', label: 'Starts with' },
        { value: 'endsWith', label: 'Ends with' },
      ]
    : [
        { value: 'eq', label: 'Equals' },
        { value: 'gt', label: 'Greater than' },
        { value: 'gte', label: 'Greater or equal' },
        { value: 'lt', label: 'Less than' },
        { value: 'lte', label: 'Less or equal' },
      ];

  const placeholder = filterKind === 'duration'
    ? 'Type 00:00 or 00:00:00'
    : filterKind === 'date'
      ? 'YYYY-MM-DD'
      : filterKind === 'number'
        ? 'Type a number'
        : 'Type to filter';

  const inputType = filterKind === 'date' ? 'date' : 'text';

  return (
    <div className="flex min-w-[250px] flex-col gap-3 overflow-hidden border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 shadow-xl">
      <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Filter</div>
      <div className="grid gap-2">
        <select
          value={draftOperator}
          onChange={(event) => {
            setDraftOperator(event.target.value as GenericTextOperator | GenericNumericOperator);
            props.onUiChange();
          }}
          className="border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12px] text-[var(--text-main)] focus:border-[var(--accent)] focus:outline-none"
        >
          {operatorOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <input
          ref={inputRef}
          type={inputType}
          value={draftValue}
          onChange={(event) => {
            setDraftValue(event.target.value);
            props.onUiChange();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              applyFilter();
            }
          }}
          placeholder={placeholder}
          className="border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-[var(--border-color)] pt-3">
        <IconActionButton title="Clear filter" onClick={clearFilter}>
          <Eraser size={13} />
        </IconActionButton>
        <IconActionButton title="Apply filter" onClick={applyFilter}>
          <Check size={13} />
        </IconActionButton>
      </div>
    </div>
  );
}



function TogglePill({ active, onClick, children, tone = "default" }: { active: boolean; onClick: () => void; children: React.ReactNode; tone?: "default" | "danger" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors ${
        active
          ? tone === 'danger'
            ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
            : 'border-[var(--accent)] bg-[var(--accent)] text-white'
          : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text-main)]'
      }`}
    >
      {children}
    </button>
  );
}

export function BooleanMapFilter(props: CustomFilterProps<any, any, BooleanMapFilterModel>) {
  const schema = (((props.colDef.filterParams as any)?.booleanMapSchema) || null) as BooleanMapSchema | null;
  const [search, setSearch] = useState('');
  const [draftSelections, setDraftSelections] = useState<Record<string, 'true' | 'false'>>(() => props.model?.selections || {});

  useEffect(() => {
    setDraftSelections(props.model?.selections || {});
  }, [props.model]);

  const doesFilterPass = useCallback(() => true, []);
  useGridFilter({ doesFilterPass });

  const keys = schema?.keys || [];
  const labels = schema?.labels || {};
  const quickKeys = useMemo(() => {
    if (schema?.quickKeys?.length) return schema.quickKeys;
    return keys.slice(0, 8);
  }, [keys, schema?.quickKeys]);

  const filteredKeys = useMemo(() => {
    if (!search.trim()) return keys;
    const lower = search.toLowerCase();
    return keys.filter((key) => (labels[key] || key).toLowerCase().includes(lower));
  }, [keys, labels, search]);

  const setKeyState = (key: string, nextState: 'any' | 'true' | 'false') => {
    setDraftSelections((current) => {
      const next = { ...current };
      if (nextState === 'any') delete next[key];
      else next[key] = nextState;
      return next;
    });
    props.onUiChange();
  };

  const toggleQuickKey = (key: string) => {
    setDraftSelections((current) => {
      const next = { ...current };
      if (next[key] === 'true') delete next[key];
      else next[key] = 'true';
      return next;
    });
    props.onUiChange();
  };

  const buildModel = (): BooleanMapFilterModel | null => {
    if (!Object.keys(draftSelections).length) return null;
    return { selections: draftSelections };
  };

  const applyFilter = () => {
    props.onModelChange(buildModel());
    closeFilter(props);
  };

  const clearFilter = () => {
    setDraftSelections({});
    setSearch('');
    props.onUiChange();
    props.onModelChange(null);
    closeFilter(props);
  };

  const activeSummary = Object.entries(draftSelections);

  return (
    <div className="flex min-w-[320px] max-h-[560px] flex-col overflow-hidden border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 shadow-xl">
      <div className="mb-3 flex items-center justify-between px-1">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Theme toggles</div>
          <div className="mt-1 text-[10px] text-[var(--text-muted)]">Quick picks on top, detailed Yes / No rules below.</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-muted)]">{activeSummary.length} active</span>
          <button type="button" onClick={clearFilter} className="text-[10px] font-medium text-[var(--accent)] transition-colors hover:opacity-80">Clear</button>
        </div>
      </div>

      <div className="mb-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Quick include</div>
        <div className="flex flex-wrap gap-2">
          {quickKeys.map((key) => (
            <div key={key}>
              <TogglePill active={draftSelections[key] === 'true'} onClick={() => toggleQuickKey(key)}>
                {labels[key] || key}
              </TogglePill>
            </div>
          ))}
        </div>
      </div>

      {activeSummary.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5 px-1">
          {activeSummary.map(([key, state]) => (
            <span key={key} className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] text-[var(--text-main)]">
              <span className="max-w-[180px] truncate">{labels[key] || key}: {state === 'true' ? 'Yes' : 'No'}</span>
              <button type="button" onClick={() => setKeyState(key, 'any')} className="text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mb-2 px-1">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search themes..."
          className="w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto pr-1">
        {filteredKeys.map((key) => {
          const state = draftSelections[key] || 'any';
          return (
            <div key={key} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-2.5">
              <div className="mb-2 text-[12px] font-medium text-[var(--text-main)]">{labels[key] || key}</div>
              <div className="flex flex-wrap gap-2">
                <TogglePill active={state === 'any'} onClick={() => setKeyState(key, 'any')}>Any</TogglePill>
                <TogglePill active={state === 'true'} onClick={() => setKeyState(key, 'true')}>Yes</TogglePill>
                <TogglePill active={state === 'false'} onClick={() => setKeyState(key, 'false')} tone="danger">No</TogglePill>
              </div>
            </div>
          );
        })}
        {filteredKeys.length === 0 && (
          <div className="p-2 px-1 text-[11px] italic text-[var(--text-muted)]">No matching themes</div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--border-color)] pt-3">
        <IconActionButton title="Clear filter" onClick={clearFilter}>
          <Eraser size={13} />
        </IconActionButton>
        <IconActionButton title="Apply filter" onClick={applyFilter}>
          <Check size={13} />
        </IconActionButton>
      </div>
    </div>
  );
}

export function TagFilter(props: CustomFilterProps<any, any, TagFilterModel>) {
  const [filterText, setFilterText] = useState('');
  const [draftSelectedValues, setDraftSelectedValues] = useState<string[]>(props.model?.values ?? []);
  const [draftMatchMode, setDraftMatchMode] = useState<'any' | 'all' | 'only'>(props.model?.matchMode ?? 'any');

  useEffect(() => {
    setDraftSelectedValues(props.model?.values ?? []);
    setDraftMatchMode(props.model?.matchMode ?? 'any');
  }, [props.model]);

  const doesFilterPass = useCallback(() => true, []);
  useGridFilter({ doesFilterPass });

  const optionItems = useMemo(() => {
    const rawOptionItems = (props.colDef.filterParams as any)?.optionItems;
    if (Array.isArray(rawOptionItems) && rawOptionItems.length) {
      return rawOptionItems
        .map((item: any) => ({
          value: String(item?.value ?? ''),
          count: Number(item?.count || 0),
        }))
        .filter((item: { value: string; count: number }) => item.value);
    }
    const options = (props.colDef.filterParams as any)?.values;
    return Array.isArray(options)
      ? options.map((value: any) => ({ value: String(value), count: 0 })).filter((item: { value: string; count: number }) => item.value)
      : [];
  }, [props.colDef.filterParams]);

  const uniqueValues = useMemo(() => optionItems.map((item: { value: string; count: number }) => item.value), [optionItems]);

  const filteredItems = useMemo(() => {
    if (!filterText) return optionItems;
    const lower = filterText.toLowerCase();
    return optionItems.filter((item: { value: string; count: number }) => item.value.toLowerCase().includes(lower));
  }, [optionItems, filterText]);

  const toggleValue = (value: string) => {
    setDraftSelectedValues((current) =>
      current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value],
    );
    props.onUiChange();
  };

  const buildModel = (): TagFilterModel | null => {
    if (draftSelectedValues.length === 0) return null;
    return {
      values: draftSelectedValues,
      matchMode: draftMatchMode,
    };
  };

  const applyFilter = () => {
    props.onModelChange(buildModel());
    closeFilter(props);
  };

  const clearFilter = () => {
    setDraftSelectedValues([]);
    setDraftMatchMode('any');
    setFilterText('');
    props.onUiChange();
    props.onModelChange(null);
    closeFilter(props);
  };

  const handleSetAll = (select: boolean) => {
    const targets = filterText ? filteredItems.map((item: { value: string; count: number }) => item.value) : uniqueValues;

    setDraftSelectedValues((current) => {
      if (select) {
        return Array.from(new Set([...current, ...targets]));
      }
      return current.filter((value) => !targets.includes(value));
    });

    props.onUiChange();
  };

  return (
    <div className="flex min-w-[250px] max-h-[500px] flex-col overflow-hidden border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 shadow-xl">
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Select options</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleSetAll(true)}
            className="text-[10px] font-medium text-[var(--accent)] transition-colors hover:opacity-80"
          >
            All
          </button>
          <span className="text-[10px] text-[var(--text-muted)]">|</span>
          <button
            type="button"
            onClick={() => handleSetAll(false)}
            className="text-[10px] font-medium text-[var(--accent)] transition-colors hover:opacity-80"
          >
            None
          </button>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 px-1">
        <div className="text-[10px] font-medium uppercase tracking-tight text-[var(--text-muted)]">Match:</div>
        <div className="flex border border-[var(--border-color)] bg-[var(--bg-primary)] p-0.5">
          <button
            type="button"
            onClick={() => {
              setDraftMatchMode('any');
              props.onUiChange();
            }}
            className={`px-2 py-0.5 text-[10px] font-bold transition-all ${
              draftMatchMode === 'any'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            ANY
          </button>
          <button
            type="button"
            onClick={() => {
              setDraftMatchMode('all');
              props.onUiChange();
            }}
            className={`px-2 py-0.5 text-[10px] font-bold transition-all ${
              draftMatchMode === 'all'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            ALL
          </button>
          <button
            type="button"
            onClick={() => {
              setDraftMatchMode('only');
              props.onUiChange();
            }}
            className={`px-2 py-0.5 text-[10px] font-bold transition-all ${
              draftMatchMode === 'only'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            ONLY
          </button>
        </div>
      </div>

      {draftSelectedValues.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5 px-1">
          {draftSelectedValues.map((value) => (
            <span key={value} className="inline-flex items-center gap-1 border border-[var(--accent)] bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] text-[var(--text-main)]">
              <span className="max-w-[140px] truncate">{value}</span>
              <button
                type="button"
                title={`Remove ${value}`}
                aria-label={`Remove ${value}`}
                onClick={() => toggleValue(value)}
                className="text-[var(--text-muted)] transition-colors hover:text-[var(--text-main)]"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mb-2 px-1">
        <div className="flex items-center gap-2 border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5">
          <Search size={12} className="text-[var(--text-muted)]" />
          <input
            type="text"
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder="Search options..."
            className="w-full bg-transparent text-[12px] text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
        </div>
      </div>

      <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto pr-1">
        {filteredItems.length === 0 && (
          <div className="p-2 px-1 text-[11px] italic text-[var(--text-muted)]">No matches found</div>
        )}
        {filteredItems.map((item: { value: string; count: number }) => {
          const value = item.value;
          return (
            <label key={value} className="group flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-2 transition-colors hover:border-[var(--accent)] hover:bg-[color-mix(in_oklab,var(--accent)_4%,transparent)]">
              <input
                type="checkbox"
                checked={draftSelectedValues.includes(value)}
                onChange={() => toggleValue(value)}
                className="h-3.5 w-3.5 border-[var(--border-color)] bg-transparent checked:bg-[var(--accent)] focus:ring-0"
              />
              <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-main)]">{value}</span>
              {item.count > 0 ? (
                <span className="shrink-0 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                  ({item.count.toLocaleString()})
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--border-color)] pt-3">
        <IconActionButton title="Clear filter" onClick={clearFilter}>
          <Eraser size={13} />
        </IconActionButton>
        <IconActionButton title="Apply filter" onClick={applyFilter}>
          <Check size={13} />
        </IconActionButton>
      </div>
    </div>
  );
}
