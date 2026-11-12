import { useState } from 'react';
import { formatRatio, type ComparedShare } from '../../../lib/compareShares';
import { percent, whole } from './format';

/** Side-by-side shares with an over/under-representation ratio; noise rows are greyed out. */
export function CompareTable({ rows, labelA, labelB, itemLabel, onSelect, initialLimit = 20 }: {
  rows: ComparedShare[];
  labelA: string;
  labelB: string;
  itemLabel: string;
  onSelect?: (row: ComparedShare) => void;
  initialLimit?: number;
}) {
  const [limit, setLimit] = useState(initialLimit);
  if (!rows.length) return <div className="dash-empty">Nothing to compare.</div>;
  return (
    <>
      <div className="dash-table-wrap">
        <table className="dash-table">
          <thead>
            <tr>
              <th className="is-text">{itemLabel}</th>
              <th title={labelA}>Here</th>
              <th title={labelB}>Comparison</th>
              <th>Ratio</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((row) => (
              <tr
                key={row.key}
                className={`${row.isNoise ? 'is-faint' : ''} ${onSelect ? 'is-interactive' : ''}`}
                onClick={onSelect ? () => onSelect(row) : undefined}
                title={row.isNoise ? 'Not a significant difference (or too few videos)' : `Log-likelihood G² = ${row.logLikelihood.toFixed(1)}`}
              >
                <td className="is-text is-title">{row.label}</td>
                <td>{percent(row.shareA, 1)} <span className="dash-note">({whole.format(row.countA)})</span></td>
                <td>{percent(row.shareB, 1)} <span className="dash-note">({whole.format(row.countB)})</span></td>
                <td className={row.isNoise ? undefined : row.ratio >= 1 ? 'dash-up' : 'dash-down'}>
                  {formatRatio(row.ratio)} {row.isNoise ? '' : row.ratio >= 1 ? '▲' : '▼'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit ? (
        <button type="button" className="dash-link-button" onClick={() => setLimit((current) => current + 30)}>Show more ({whole.format(rows.length - limit)} left)</button>
      ) : null}
    </>
  );
}
