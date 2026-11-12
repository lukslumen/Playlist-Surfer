// Compares how often items (terms, buckets, domains) occur in two sets of videos: side-by-side shares, a
// ratio, and Dunning's log-likelihood (G²) to separate real differences from noise. G² is the usual
// "keyness" statistic in corpus linguistics; 3.84 corresponds to p < 0.05 with one degree of freedom.

export interface ShareCount {
  key: string;
  label: string;
  count: number;
}

export interface ComparedShare {
  key: string;
  label: string;
  countA: number;
  shareA: number;
  countB: number;
  shareB: number;
  /** shareA / shareB, smoothed so an item missing from one side still gets a finite ratio. */
  ratio: number;
  logLikelihood: number;
  /** Too few videos, or not significant: shown greyed out so it doesn't read as a finding. */
  isNoise: boolean;
}

export const SIGNIFICANCE_THRESHOLD = 3.84;
export const MIN_COUNT = 3;

/** Dunning's G² for an item seen `a` times in `totalA` and `b` times in `totalB`. */
export function logLikelihood(a: number, totalA: number, b: number, totalB: number): number {
  const total = totalA + totalB;
  if (!total || (!a && !b)) return 0;
  const expectedA = (totalA * (a + b)) / total;
  const expectedB = (totalB * (a + b)) / total;
  const part = (observed: number, expected: number) => (observed > 0 && expected > 0 ? observed * Math.log(observed / expected) : 0);
  return 2 * (part(a, expectedA) + part(b, expectedB));
}

/**
 * Every item from either side with both shares, sorted by significance (G²) so the strongest over- and
 * under-representations come first; noise goes last.
 */
export function compareShares(a: ShareCount[], totalA: number, b: ShareCount[], totalB: number): ComparedShare[] {
  const byKey = new Map<string, { label: string; countA: number; countB: number }>();
  a.forEach((item) => byKey.set(item.key, { label: item.label, countA: item.count, countB: 0 }));
  b.forEach((item) => {
    const entry = byKey.get(item.key);
    if (entry) entry.countB = item.count;
    else byKey.set(item.key, { label: item.label, countA: 0, countB: item.count });
  });
  const rows = [...byKey.entries()].map(([key, entry]) => {
    const shareA = totalA ? entry.countA / totalA : 0;
    const shareB = totalB ? entry.countB / totalB : 0;
    const ratio = ((entry.countA + 0.5) / (totalA + 1)) / ((entry.countB + 0.5) / (totalB + 1));
    const g2 = logLikelihood(entry.countA, totalA, entry.countB, totalB);
    return {
      key,
      label: entry.label,
      countA: entry.countA,
      shareA,
      countB: entry.countB,
      shareB,
      ratio,
      logLikelihood: g2,
      isNoise: g2 < SIGNIFICANCE_THRESHOLD || Math.max(entry.countA, entry.countB) < MIN_COUNT,
    };
  });
  return rows.sort((x, y) => (Number(x.isNoise) - Number(y.isNoise)) || (y.logLikelihood - x.logLikelihood) || x.label.localeCompare(y.label));
}

/** "3.1×", "0.25×": ratios near 1 get one decimal, large ones none. */
export function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  if (ratio >= 10) return `${Math.round(ratio)}×`;
  if (ratio >= 0.1) return `${ratio.toFixed(ratio >= 1 ? 1 : 2).replace(/\.?0+$/, '')}×`;
  return `${ratio.toFixed(3).replace(/0+$/, '')}×`;
}

export const COMPARE_METHOD_CAVEATS = [
  'Ratios compare shares of videos, not raw counts, so sets of different sizes can be compared.',
  'Grey rows are not significant (log-likelihood G² below 3.84, p ≥ 0.05) or have fewer than 3 videos on both sides: treat them as noise.',
  'When the comparison set contains the current set (filtered view against the whole dataset), differences are understated.',
];
