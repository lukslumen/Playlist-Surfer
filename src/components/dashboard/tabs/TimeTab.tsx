import { useState } from 'react';
import { DashPanel, Segmented } from '../DashPanel';
import type { DashboardTabProps } from '../TemplateDashboard';
import { PeriodHeatTable, RhythmHeatmap, ScatterChart } from './charts';
import { compact, percent, whole } from './format';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
type TermUnit = 'hashtags' | 'tags' | 'words';
const TERM_UNITS: Array<{ value: TermUnit; label: string }> = [
  { value: 'hashtags', label: 'Hashtags' },
  { value: 'tags', label: 'Tags' },
  { value: 'words', label: 'Title words' },
];
const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function TimeTab({ snapshot, compare, scopeLabel, onDrilldown, onNavigateToVideo }: DashboardTabProps) {
  const time = snapshot.time!;
  const compareTime = compare?.snapshot.time;
  const [zone, setZone] = useState<'utc' | 'local'>('utc');
  const [termUnit, setTermUnit] = useState<TermUnit>(() => (time.terms.hashtags.length ? 'hashtags' : 'tags'));
  const grid = zone === 'utc' ? time.rhythm.utc : time.rhythm.local;
  const zoneLabel = zone === 'utc' ? 'UTC' : time.rhythm.localZone;

  // Rhythm headline: the busiest weekday and the busiest three-hour window.
  const dayTotals = grid.map((hours) => hours.reduce((sum, value) => sum + value, 0));
  const busiestDay = dayTotals.indexOf(Math.max(...dayTotals));
  const hourTotals = Array.from({ length: 24 }, (_, hour) => grid.reduce((sum, hours) => sum + hours[hour], 0));
  const windowTotals = hourTotals.map((_, hour) => hourTotals[hour] + hourTotals[(hour + 1) % 24] + hourTotals[(hour + 2) % 24]);
  const busiestWindow = windowTotals.indexOf(Math.max(...windowTotals));
  const windowShare = time.datedVideos ? windowTotals[busiestWindow] / time.datedVideos : 0;

  const medians = time.viewsByDate.medians;
  const firstMedian = medians[0];
  const lastMedian = medians[medians.length - 1];
  const periodLabel = (startTs: number) => time.periods.find((period) => period.startTs === startTs)?.label ?? DATE_FMT.format(startTs);

  const termRows = time.terms[termUnit];
  const rise = termRows
    .map((term) => {
      const values = term.shares.filter((_, index) => time.periods[index].videos >= 3);
      return { term, change: values.length >= 2 ? values[values.length - 1] - values[0] : 0, first: values[0] ?? 0, last: values[values.length - 1] ?? 0 };
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
  const periodsWithVideos = time.periods.filter((period) => period.videos >= 3);

  if (!time.datedVideos) {
    return <main className="dash"><section className="dash-card"><div className="dash-empty">No valid publish dates in this scope.</div></section></main>;
  }

  return (
    <main className="dash">
      <div className="dash-row is-2">
        <DashPanel
          title="Publishing rhythm"
          context={scopeLabel}
          headline={<>Most uploads go out on <strong>{DAYS[busiestDay]}s</strong>; {percent(windowShare)} between <strong>{String(busiestWindow).padStart(2, '0')}:00 and {String((busiestWindow + 3) % 24).padStart(2, '0')}:00</strong> {zoneLabel}.</>}
          controls={<Segmented label="Time zone" value={zone} onChange={setZone} options={[{ value: 'utc', label: 'UTC' }, { value: 'local', label: time.rhythm.localZone }]} />}
          method={{
            computed: `Each upload's publish time (YouTube reports UTC) is counted by weekday and hour, in UTC or in ${time.rhythm.localZone} (the time zone of the computer that generated this snapshot). Darker cells have more uploads. ${whole.format(time.datedVideos)} videos have a publish date.`,
            read: 'Columns of dark cells show a habitual publishing hour; rows show favoured weekdays. Scheduled uploads often cluster on the hour.',
            caveats: [
              'Publish time is when a video went public, which can differ from upload time (scheduled or premiered videos).',
              "Channels in other time zones publish at their local times; UTC is the neutral reference for comparing them.",
            ],
          }}
          csv={() => ({
            columns: ['weekday', 'hour', 'uploads_utc', `uploads_${time.rhythm.localZone}`],
            rows: DAYS.flatMap((day, dayIndex) => Array.from({ length: 24 }, (_, hour) => [day, hour, time.rhythm.utc[dayIndex][hour], time.rhythm.local[dayIndex][hour]])),
          })}
        >
          <RhythmHeatmap
            grid={grid}
            max={time.rhythm.max}
            ghost={compareTime ? { grid: zone === 'utc' ? compareTime.rhythm.utc : compareTime.rhythm.local, total: compareTime.datedVideos, ownTotal: time.datedVideos } : undefined}
          />
        </DashPanel>

        <DashPanel
          title="Views by publish date"
          context={scopeLabel}
          headline={firstMedian && lastMedian && firstMedian !== lastMedian
            ? <>Typical views went from <strong>{compact.format(firstMedian.median)}</strong> for videos from {periodLabel(firstMedian.startTs)} to <strong>{compact.format(lastMedian.median)}</strong> for {periodLabel(lastMedian.startTs)}.</>
            : 'Not enough videos per period to show a trend.'}
          method={{
            computed: `Each dot is a video: publish date against views (log scale). The line is the median views of the videos published in each ${time.periodUnit} (periods with at least 3 videos). ${time.viewsByDate.points.length < time.viewsByDate.total ? `Shows an even sample of ${whole.format(time.viewsByDate.points.length)} of ${whole.format(time.viewsByDate.total)} videos.` : ''}`,
            read: 'A falling line toward recent dates usually means recent videos have not had time to collect views, not that they are less popular. A rising line despite that means newer videos reach more people.',
            caveats: [
              'Views are cumulative at the time of collection, so older videos have had longer to gather them.',
              'Videos removed before collection are missing, which can make older periods look more successful (survivorship).',
            ],
          }}
          csv={() => ({
            columns: ['period_start', 'period', 'median_views', 'videos'],
            rows: medians.map((entry) => [new Date(entry.startTs).toISOString().slice(0, 10), periodLabel(entry.startTs), Math.round(entry.median), entry.videos]),
          })}
        >
          <ScatterChart
            xScale="time"
            yLog
            xLabel="publish date"
            yLabel="views (log scale)"
            points={time.viewsByDate.points.map((point) => ({ id: point.videoId, x: point.ts, y: point.views, title: point.title, detail: `${DATE_FMT.format(point.ts)} · ${compact.format(point.views)} views` }))}
            ghost={compareTime?.viewsByDate.points.map((point) => ({ x: point.ts, y: point.views }))}
            line={medians.map((entry) => ({ x: (entry.startTs + entry.endTs) / 2, y: entry.median }))}
            onSelect={onNavigateToVideo}
            legend={<div className="dash-legend"><span><i style={{ background: 'var(--d-text)' }} />median per {time.periodUnit}</span>{compareTime ? <span><i style={{ background: 'var(--d-muted)' }} />{compare!.label}</span> : null}</div>}
          />
        </DashPanel>
      </div>

      <DashPanel
        title="Channel activity over time"
        context={scopeLabel}
        headline={time.channelCount < 2
          ? 'This set has one channel, so there is no channel activity to compare.'
          : <>{whole.format(time.channelCount)} channels; the {Math.min(time.channelCount, time.channels.length)} with the most videos are shown. <strong>{time.channels[0]?.label}</strong> published the most ({whole.format(time.channels[0]?.videos ?? 0)}).</>}
        method={{
          computed: `Videos per ${time.periodUnit} for the ${time.channels.length} channels with the most videos in this set. Darker cells have more videos.`,
          read: 'Read rows left to right to see when a channel entered or left the space; read columns to see who dominated a period.',
          caveats: ['Only videos in this dataset count, not the channels\' full upload history.'],
        }}
        csv={() => ({
          columns: ['channel', ...time.periods.map((period) => period.label), 'total'],
          rows: time.channels.map((channel) => [channel.label, ...channel.counts, channel.videos]),
        })}
      >
        {time.channelCount < 2 ? null : (
          <PeriodHeatTable
            ariaLabel="Videos per channel and period"
            periods={time.periods.map((period) => period.label)}
            rows={time.channels.map((channel) => ({ key: channel.key, label: channel.label, values: channel.counts, total: whole.format(channel.videos) }))}
            format={(value) => whole.format(value)}
          />
        )}
      </DashPanel>

      <DashPanel
        title="Vernacular over time"
        context={scopeLabel}
        headline={rise && Math.abs(rise.change) >= 0.05
          ? <><strong>{rise.term.label}</strong> {rise.change > 0 ? 'rose' : 'fell'} from {percent(rise.first)} of videos in {periodsWithVideos[0]?.label} to {percent(rise.last)} in {periodsWithVideos[periodsWithVideos.length - 1]?.label}.</>
          : termRows.length ? 'The most used terms stay roughly level over time.' : 'No terms of this kind in this scope.'}
        controls={<Segmented label="Unit" value={termUnit} onChange={setTermUnit} options={TERM_UNITS} />}
        method={{
          computed: `For the ${termRows.length} most used ${TERM_UNITS.find((entry) => entry.value === termUnit)!.label.toLowerCase()} overall, the share of each ${time.periodUnit}'s videos that use them (with the same stopwords and hidden terms as the Vernacular tab).`,
          read: 'Rising rows show terms entering the vocabulary; falling rows show terms going out of use. Click a row to see its videos.',
          caveats: ['Periods with few videos swing a lot: one video can be 50% of a period. The headline ignores periods with fewer than 3 videos.'],
        }}
        csv={() => ({
          columns: ['term', ...time.periods.map((period) => period.label), 'videos_total'],
          rows: termRows.map((term) => [term.label, ...term.shares.map((share) => share.toFixed(4)), term.videos]),
        })}
      >
        <PeriodHeatTable
          ariaLabel="Share of videos using each term per period"
          periods={time.periods.map((period) => `${period.label}`)}
          rows={termRows.map((term) => ({
            key: term.key,
            label: term.label,
            values: term.shares,
            total: whole.format(term.videos),
            onSelect: onDrilldown ? () => onDrilldown({ kind: 'term', unit: termUnit, value: term.label }) : undefined,
          }))}
          format={(value) => percent(value)}
        />
      </DashPanel>
    </main>
  );
}
