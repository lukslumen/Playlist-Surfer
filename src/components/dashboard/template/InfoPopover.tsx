import { useEffect, useMemo, useState } from 'react';

export type InfoProps = {
  label: string;
  oneLine: string;
  method: string;
  codeSnippet: string;
  codeExplanation?: string;
};

export function InfoPopover({ label, oneLine, method, codeExplanation }: InfoProps) {
  const [open, setOpen] = useState(false);
  const id = useMemo(() => `metric-info-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, [label]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const sections = [
    { title: 'What this shows', body: oneLine },
    { title: 'How it is constructed', body: method },
    ...(codeExplanation ? [{ title: 'How to read it', body: codeExplanation }] : []),
  ];

  return (
    <span className="info-wrap">
      <button
        type="button"
        className="info-button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`How ${label} is calculated`}
        onClick={() => setOpen((current) => !current)}
      >
        i
      </button>

      {open ? (
        <div className="info-overlay" onClick={() => setOpen(false)}>
          <div className="info-popover" id={id} role="dialog" aria-label={`${label} explanation`} onClick={(event) => event.stopPropagation()}>
            <div className="info-head">
              <div>
                <div className="info-title">{label}</div>
                <div className="info-summary">{oneLine}</div>
              </div>
              <button type="button" className="info-close" onClick={() => setOpen(false)} aria-label="Close metric explanation">×</button>
            </div>
            <div className="info-method-copy">
              {sections.map((section) => (
                <section key={section.title} className="info-method-section">
                  <div className="info-method-title">{section.title}</div>
                  <p className="info-method-paragraph">{section.body}</p>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </span>
  );
}

export function MetricHeader({ title, info }: { title: string; info: InfoProps }) {
  return (
    <div className="section-title section-title-row">
      <span>{title}</span>
      <InfoPopover {...info} />
    </div>
  );
}
