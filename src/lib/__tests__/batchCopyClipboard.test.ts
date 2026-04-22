import { buildBatchCopyClipboardPayload } from '../data';

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const rows = [
  { videoId: 'v1', channelId: 'c1' },
  { video_id: 'v2', channel_id: 'c2' },
  { videoId: 'v4', 'channel id': 'c3' },
  { videoId: 'v5', 'Channel ID': 'c4' },
  { videoId: 'v1', channelId: 'c1' },
  { videoId: 'v3' },
  { id: 'legacy-video-id-only' },
];

const videoIds = buildBatchCopyClipboardPayload(rows, 'videoIds');
assert(
  JSON.stringify(videoIds.values) === JSON.stringify(['v1', 'v2', 'v4', 'v5', 'v3', 'legacy-video-id-only']),
  'Video IDs should dedupe while preserving first-seen order.',
);
assert(
  videoIds.text === 'v1,v2,v4,v5,v3,legacy-video-id-only',
  'Video ID clipboard text should be a comma-separated list.',
);

const videoUrls = buildBatchCopyClipboardPayload(rows, 'videoUrls');
assert(
  JSON.stringify(videoUrls.values) === JSON.stringify([
    'https://www.youtube.com/watch?v=v1',
    'https://www.youtube.com/watch?v=v2',
    'https://www.youtube.com/watch?v=v4',
    'https://www.youtube.com/watch?v=v5',
    'https://www.youtube.com/watch?v=v3',
    'https://www.youtube.com/watch?v=legacy-video-id-only',
  ]),
  'Video URLs should be generated canonically from video IDs.',
);

const channelIds = buildBatchCopyClipboardPayload(rows, 'channelIds');
assert(
  JSON.stringify(channelIds.values) === JSON.stringify(['c1', 'c2', 'c3', 'c4']),
  'Channel IDs should skip missing values and should not fallback to generic id.',
);
assert(
  channelIds.text === 'c1,c2,c3,c4',
  'Channel IDs clipboard text should be comma-separated without placeholders.',
);

const channelUrls = buildBatchCopyClipboardPayload(rows, 'channelUrls');
assert(
  JSON.stringify(channelUrls.values) === JSON.stringify([
    'https://www.youtube.com/channel/c1',
    'https://www.youtube.com/channel/c2',
    'https://www.youtube.com/channel/c3',
    'https://www.youtube.com/channel/c4',
  ]),
  'Channel URLs should be generated canonically from channel IDs.',
);

console.log('batchCopyClipboard.test.ts: ok');
