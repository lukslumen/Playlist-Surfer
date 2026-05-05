import { resolveThumbnailUrlsForRow, selectThumbnailCandidates } from '../dashboardThumbnails';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const nestedUrls = resolveThumbnailUrlsForRow({
  thumbnail: '{"high":{"url":"https://cdn.example.com/high.jpg"}}',
});
assert(nestedUrls[0] === 'https://cdn.example.com/high.jpg', 'Nested JSON thumbnail URL should resolve.');

const embeddedUrls = resolveThumbnailUrlsForRow({
  thumbnail: 'preview: https://cdn.example.com/embedded.webp',
});
assert(embeddedUrls[0] === 'https://cdn.example.com/embedded.webp', 'Embedded HTTP thumbnail URL should resolve.');

const protocolRelative = resolveThumbnailUrlsForRow({
  thumbnail_default: '//cdn.example.com/default.jpg',
});
assert(protocolRelative[0] === 'https://cdn.example.com/default.jpg', 'Protocol-relative URLs should normalize to https.');

const fallbackFromWatchUrl = resolveThumbnailUrlsForRow({
  videoId: 'https://www.youtube.com/watch?v=abc123xyz',
});
assert(
  fallbackFromWatchUrl.some((url) => url.includes('/vi/abc123xyz/hqdefault.jpg')),
  'YouTube watch URLs should produce fallback thumbnail candidates from extracted video id.',
);

const candidates = selectThumbnailCandidates({
  rows: [
    { videoId: 'video-a', thumbnail: '{"default":{"url":"https://cdn.example.com/a.jpg"}}', viewCount: 1000 },
    { videoId: 'video-b', thumbnail: 'bad-url', viewCount: 900 },
  ],
  limit: 10,
});
const videoACandidate = candidates.find((entry) => entry.videoId === 'video-a');
const videoBCandidate = candidates.find((entry) => entry.videoId === 'video-b');
assert(Boolean(videoACandidate), 'Valid rows should become candidates.');
assert(Boolean(videoBCandidate), 'Rows with video ids should still get YouTube fallback candidates.');
assert(
  Boolean(videoBCandidate?.candidateUrls?.some((url) => url.includes('/vi/video-b/hqdefault.jpg'))),
  'Rows without valid direct thumbnail URLs should include YouTube fallback URLs.',
);

console.log('dashboardThumbnails.test.ts: ok');
