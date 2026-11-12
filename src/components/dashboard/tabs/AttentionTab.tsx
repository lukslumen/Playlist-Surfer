import { useMemo, useState } from 'react';
import { attentionVideos, BREAKOUT_RATIO, MIN_CHANNEL_VIDEOS, MIN_VIEWS_FOR_ENGAGEMENT, type AttentionMetric, type AttentionUnit, type AttentionVideo } from '../../../lib/attentionProfile';
import { DashPanel, Segmented } from '../DashPanel';
import type { DashboardTabProps } from '../TemplateDashboard';
import { ConcentrationChart, ScatterChart } from './charts';
import { compact, METRIC_LABEL, percent, rate, times, whole } from './format';

type SortKey = 'views' | 'engagement' | 'vsChannel' | 'perSubscriber';

const videoCsv = (videos: AttentionVideo[]) => ({
  columns: ['videoId', 'title', 'channel', 'views', 'likes', 'comments', 'likes_and_comments_per_1k_views', 'views_vs_channel_median', 'views_per_channel_subscriber'],
  rows: videos.map((video) => [video.videoId, video.title, video.channel, video.views, video.likes, video.comments, video.engagement?.toFixed(2), video.vsChannel?.toFixed(3), video.perSubscriber?.toFixed(4)]),
});

export function AttentionTab({ snapshot, compare, scopeLabel, onNavigateToVideo, getScopeRecords }: DashboardTabProps) {
  const attention = snapshot.attention!;
  const compareAttention = compare?.snapshot.attention;
  const channelCount = snapshot.profile?.channels ?? snapshot.overview.uniqueChannels;
  const [unit, setUnit] = useState<AttentionUnit>('videos');
  const [metric, setMetric] = useState<AttentionMetric>('views');
  const [sort, setSort] = useState<SortKey>('views');
  const [limit, setLimit] = useState(25);
  const effectiveUnit: AttentionUnit = channelCount < 2 ? 'videos' : unit;
  const curve = attention.curves[effectiveUnit][metric];
  const compareCurve = compareAttention?.curves[effectiveUnit][metric];
  const unitLabel = effectiveUnit === 'videos' ? 'videos' : 'channels';
  const metricLabel = METRIC_LABEL[metric];

  const allVideos = () => (getScopeRecords ? attentionVideos(getScopeRecords()).videos : attention.ranked);

  const ranked = useMemo(() => {
    const score = (video: AttentionVideo) => (sort === 'views' ? video.views : sort === 'engagement' ? video.engagement : sort === 'vsChannel' ? video.vsChannel : (video.perSubscriber ?? null));
    return attention.ranked.filter((video) => score(video) !== null).sort((a, b) => (score(b) as number) - (score(a) as number));
  }, [attention.ranked, sort]);

  const concentrationHeadline = curve.count ? (
    <>
      The top 10% of {unitLabel} get <strong>{percent(curve.top10)}</strong> of all {metricLabel}
      {compareCurve?.count ? <> (vs {percent(compareCurve.top10)} in {compare!.label})</> : null}; the top 1% get {percent(curve.top1)}. Gini {curve.gini.toFixed(2)}.
    </>
  ) : `No ${metricLabel} counts in this scope.`;

  const breakouts = attention.breakoutCount;

  return (
    <main className="dash">
      <div className="dash-row is-2">
        <DashPanel
          title="Concentration of attention"
          context={scopeLabel}
          headline={concentrationHeadline}
          controls={(
            <>
              <Segmented label="Unit" value={effectiveUnit} onChange={setUnit} options={[{ value: 'videos', label: 'Videos' }, { value: 'channels', label: 'Channels', disabled: channelCount < 2 }]} />
              <Segmented label="Metric" value={metric} onChange={setMetric} options={[{ value: 'views', label: 'Views' }, { value: 'likes', label: 'Likes' }, { value: 'comments', label: 'Comments' }]} />
            </>
          )}
          method={{
            computed: `${effectiveUnit === 'videos' ? 'Videos' : 'Channels (the sum of their videos)'} are sorted from most to least ${metricLabel}. The curve shows the share of all ${metricLabel} held by the first x% of them. The Gini coefficient summarises the curve: 0 means every item has the same, 1 means one item has everything. ${whole.format(curve.count)} ${unitLabel} with a value are included.`,
            read: 'The further the curve bows above the dashed diagonal, the more attention is concentrated in a few items. A curve close to the diagonal means attention is spread evenly.',
            caveats: [
              'Counts are cumulative at the time of collection: older videos have had longer to gather views.',
              'A dataset built from a search, playlist or channel list is already a selection. The inequality describes that selection, not YouTube as a whole.',
              'Videos with hidden like or comment counts are left out of those metrics.',
            ],
          }}
          csv={() => ({
            columns: ['share_of_items', 'cumulative_share', 'metric', 'unit', 'top_1pct', 'top_10pct', 'top_20pct', 'gini'],
            rows: curve.points.map(([x, y], index) => [x.toFixed(4), y.toFixed(4), metric, effectiveUnit, ...(index === 0 ? [curve.top1.toFixed(4), curve.top10.toFixed(4), curve.top20.toFixed(4), curve.gini.toFixed(4)] : ['', '', '', ''])]),
          })}
        >
          <ConcentrationChart
            marker={curve.count ? { x: Math.ceil(curve.count * 0.1) / curve.count, y: curve.top10, label: `top 10%: ${percent(curve.top10)}` } : undefined}
            xLabel={`share of ${unitLabel}, largest first`}
            yLabel={`share of ${metricLabel}`}
            curves={[
              ...(compareCurve?.count ? [{ label: compare!.label, points: compareCurve.points, ghost: true }] : []),
              { label: scopeLabel, points: curve.points },
            ]}
          />
          {compareCurve?.count ? (
            <div className="dash-legend"><span><i style={{ background: 'var(--d-accent)' }} />{scopeLabel}</span><span><i style={{ background: 'var(--d-muted)' }} />{compare!.label}</span></div>
          ) : null}
        </DashPanel>

        <DashPanel
          title="Views vs engagement"
          context={scopeLabel}
          headline={attention.medianEngagement === null ? 'No videos with enough views and engagement counts.' : (
            <>
              The typical video gets <strong>{rate(attention.medianEngagement)}</strong> likes and comments per 1,000 views.
              {breakouts ? <> {whole.format(breakouts)} {breakouts === 1 ? 'video has' : 'videos have'} {BREAKOUT_RATIO}× or more their channel's typical views (highlighted).</> : null}
            </>
          )}
          method={{
            computed: `Each dot is a video. Horizontal: views, on a log scale. Vertical: likes plus comments per 1,000 views. Only videos with at least ${whole.format(MIN_VIEWS_FOR_ENGAGEMENT)} views are shown, because rates for very small videos are mostly noise. Highlighted videos have at least ${BREAKOUT_RATIO}× the median views of their own channel (channels with ${MIN_CHANNEL_VIDEOS}+ videos in the set). ${attention.scatter.length < attention.scatterTotal ? `Shows ${whole.format(attention.scatter.length)} of ${whole.format(attention.scatterTotal)} videos: an even sample across the view range plus every stand-out.` : ''}`,
            read: 'Dots high up engage their audience more than their reach would suggest; dots far right reached many people. Engagement rates usually fall as views rise, so compare videos of similar reach.',
            caveats: [
              'Likes and comments can be hidden or disabled by the creator; those videos have lower or missing rates.',
              'Comment counts include replies and can be inflated by spam or deleted later.',
              'The vertical axis is cut at the 99th percentile so one extreme video does not flatten the rest.',
            ],
          }}
          csv={() => videoCsv(allVideos())}
        >
          <ScatterChart
            xLabel="views (log scale)"
            yLabel="likes + comments per 1K views"
            points={attention.scatter.map((video) => ({
              id: video.videoId,
              x: video.views as number,
              y: video.engagement as number,
              highlight: video.vsChannel !== null && video.vsChannel >= BREAKOUT_RATIO,
              title: video.title,
              detail: `${compact.format(video.views as number)} views · ${rate(video.engagement)} per 1K${video.vsChannel !== null ? ` · ${times(video.vsChannel)} channel median` : ''}`,
            }))}
            ghost={compareAttention?.scatter.map((video) => ({ x: video.views as number, y: video.engagement as number }))}
            onSelect={onNavigateToVideo}
            legend={(
              <div className="dash-legend">
                <span><i style={{ background: 'var(--d-accent)' }} />{BREAKOUT_RATIO}× channel median or more</span>
                <span><i style={{ background: 'var(--d-bar)' }} />other videos</span>
                {compareAttention ? <span><i style={{ background: 'var(--d-muted)' }} />{compare!.label}</span> : null}
              </div>
            )}
          />
        </DashPanel>
      </div>

      <DashPanel
        title="Ranked videos"
        context={scopeLabel}
        headline={sort === 'vsChannel'
          ? (attention.channelsWithNorm ? `Videos that did best against their own channel's typical views (${whole.format(attention.channelsWithNorm)} channels with ${MIN_CHANNEL_VIDEOS}+ videos).` : `No channel has ${MIN_CHANNEL_VIDEOS} or more videos here, so there is no channel norm to compare against.`)
          : sort === 'engagement' ? `Videos with the most likes and comments per 1,000 views (at least ${whole.format(MIN_VIEWS_FOR_ENGAGEMENT)} views).`
            : sort === 'perSubscriber' ? "Videos that reached far beyond their channel's subscriber base (views ÷ subscribers)." : 'The most viewed videos.'}
        controls={(
          <Segmented label="Sort" value={sort} onChange={(next) => { setSort(next); setLimit(25); }} options={[
            { value: 'views', label: 'Views' },
            { value: 'engagement', label: 'Engagement' },
            { value: 'vsChannel', label: '× channel' },
            ...(attention.hasSubscribers ? [{ value: 'perSubscriber' as const, label: 'Per subscriber' }] : []),
          ]} />
        )}
        method={{
          computed: `Views, likes and comments as collected. Engagement = (likes + comments) ÷ views × 1,000, for videos with at least ${whole.format(MIN_VIEWS_FOR_ENGAGEMENT)} views. "× channel" = the video's views ÷ the median views of its channel's videos in this set, for channels with at least ${MIN_CHANNEL_VIDEOS} videos. ${attention.hasSubscribers ? ' "Per subscriber" = views ÷ the channel\'s subscriber count from the export\'s channel metadata; above 1 means the video reached more people than the channel has subscribers.' : ''} The table holds the top 200 for each sort; the CSV has every video.`,
          read: '"× channel" finds breakout videos: 5× means five times the channel\'s typical video, which matters more for a small channel than raw views do. Click a row to open the video.',
          caveats: [
            'The channel norm only uses that channel\'s videos in this dataset, not its whole catalogue.',
            'Recently published videos have had less time to collect views, so they rank lower on views and × channel.',
          ],
        }}
        csv={() => videoCsv(allVideos())}
      >
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th className="is-text">#</th>
                <th className="is-text">Title</th>
                <th className="is-text">Channel</th>
                <th>Views</th>
                <th title="likes + comments per 1,000 views">Engagement</th>
                <th title="views ÷ channel median views">× channel</th>
                {attention.hasSubscribers ? <th title="views ÷ channel subscribers">Per subscriber</th> : null}
              </tr>
            </thead>
            <tbody>
              {ranked.slice(0, limit).map((video, index) => (
                <tr key={video.videoId} className={onNavigateToVideo ? 'is-interactive' : undefined} onClick={() => onNavigateToVideo?.(video.videoId)}>
                  <td className="is-text dash-note">{index + 1}</td>
                  <td className="is-text is-title" title={video.title}>{video.title}</td>
                  <td className="is-text is-title" title={video.channel}>{video.channel}</td>
                  <td>{video.views === null ? '—' : compact.format(video.views)}</td>
                  <td>{rate(video.engagement)}</td>
                  <td className={video.vsChannel !== null && video.vsChannel >= BREAKOUT_RATIO ? 'dash-up' : undefined}>{times(video.vsChannel)}</td>
                  {attention.hasSubscribers ? <td className={video.perSubscriber != null && video.perSubscriber >= 1 ? 'dash-up' : undefined}>{video.perSubscriber == null ? '—' : video.perSubscriber >= 10 ? times(video.perSubscriber) : video.perSubscriber.toFixed(2)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ranked.length > limit ? (
          <button type="button" className="dash-link-button" onClick={() => setLimit((current) => current + 25)}>Show more ({whole.format(Math.min(ranked.length, 200) - limit)} left)</button>
        ) : null}
      </DashPanel>
    </main>
  );
}
