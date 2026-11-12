import { useCallback, useEffect, useRef, useState } from 'react';
import { loadYouTubeApi } from '../../lib/youtubeApi';
import { mergeRanges, playbackRange, type WatchRange } from '../../lib/watchCoverage';

/** A playhead move this far from where steady playback would put it counts as a jump. */
const SEEK_TOLERANCE_SECONDS = 1.5;

export interface WatchSession {
  videoId: string;
  title: string;
  startedAt: string;
  endedAt: string;
  watchedSeconds: number;
  durationSeconds: number | null;
  qualifies: boolean;
  /** The parts of the video played in this session, as [start, end] seconds. */
  ranges: WatchRange[];
}

/**
 * Whether a viewing counts as "watched": more than 30 s, or for videos of 30 s or less, (almost)
 * the whole video.
 */
export function qualifiesAsWatched(watchedSeconds: number, durationSeconds: number | null) {
  return watchedSeconds > 30 || (
    durationSeconds !== null
    && durationSeconds <= 30
    && watchedSeconds >= Math.max(durationSeconds * 0.9, durationSeconds - 1)
  );
}

/**
 * The embedded YouTube player for the selected video: creates and tears down the IFrame player,
 * tracks its state and duration, and reports watch sessions (time actually played) on pause, end
 * or when switching away.
 */
export function useYouTubePlayer(args: {
  enabled: boolean;
  videoId: string | null;
  videoTitle: string;
  onWatchSession?: (session: WatchSession) => void;
}) {
  const { enabled, videoId, videoTitle, onWatchSession } = args;
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const playerFrameRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerState, setPlayerState] = useState<number | null>(null);
  const [playerLoadError, setPlayerLoadError] = useState<string | null>(null);
  const watchSessionRef = useRef<{
    videoId: string | null;
    title: string;
    startedAtMs: number | null;
    accumulatedSeconds: number;
    segmentStartedAtMs: number | null;
    segmentStartedPlayerSeconds: number | null;
    durationSeconds: number | null;
    ranges: WatchRange[];
  }>({
    videoId: null,
    title: '',
    startedAtMs: null,
    accumulatedSeconds: 0,
    segmentStartedAtMs: null,
    segmentStartedPlayerSeconds: null,
    durationSeconds: null,
    ranges: [],
  });

  // Where the playhead was at the last check while playing, to notice jumps (seeks).
  const lastSeenRef = useRef<{ playerSeconds: number; atMs: number } | null>(null);

  const closeActiveWatchSegment = useCallback((player?: any) => {
    const session = watchSessionRef.current;
    if (session.segmentStartedAtMs === null) return;
    const nowMs = Date.now();
    let currentPlayerSeconds = Number(player?.getCurrentTime?.() ?? Number.NaN);
    // After a jump the playhead is already somewhere else: end the segment where playback was.
    const seen = lastSeenRef.current;
    if (seen && Number.isFinite(currentPlayerSeconds)) {
      const expected = seen.playerSeconds + (nowMs - seen.atMs) / 1000;
      if (Math.abs(currentPlayerSeconds - expected) > SEEK_TOLERANCE_SECONDS) currentPlayerSeconds = expected;
    }
    lastSeenRef.current = null;
    const hasPlayerDelta = Number.isFinite(currentPlayerSeconds) && session.segmentStartedPlayerSeconds !== null;
    const delta = hasPlayerDelta
      ? Math.max(0, currentPlayerSeconds - Number(session.segmentStartedPlayerSeconds))
      : Math.max(0, (nowMs - session.segmentStartedAtMs) / 1000);
    session.accumulatedSeconds += delta;
    if (hasPlayerDelta) {
      const range = playbackRange(Number(session.segmentStartedPlayerSeconds), currentPlayerSeconds, (nowMs - session.segmentStartedAtMs) / 1000);
      if (range) session.ranges.push(range);
    }
    session.segmentStartedAtMs = null;
    session.segmentStartedPlayerSeconds = null;
  }, []);

  // A jump while playing doesn't always change the player state, so check the playhead as it plays
  // and split the segment at a jump: each stretch actually played is then counted on its own.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const session = watchSessionRef.current;
      const player = playerRef.current;
      if (session.segmentStartedAtMs === null || !player?.getCurrentTime) return;
      const nowMs = Date.now();
      const current = Number(player.getCurrentTime());
      if (!Number.isFinite(current)) return;
      const seen = lastSeenRef.current;
      if (seen && Math.abs(current - (seen.playerSeconds + (nowMs - seen.atMs) / 1000)) > SEEK_TOLERANCE_SECONDS) {
        closeActiveWatchSegment(player);
        session.segmentStartedAtMs = nowMs;
        session.segmentStartedPlayerSeconds = current;
      }
      lastSeenRef.current = { playerSeconds: current, atMs: nowMs };
    }, 500);
    return () => window.clearInterval(interval);
  }, [closeActiveWatchSegment]);

  const flushWatchSession = useCallback((player?: any) => {
    const session = watchSessionRef.current;
    closeActiveWatchSegment(player);
    if (!session.videoId || session.startedAtMs === null || session.accumulatedSeconds <= 0) {
      watchSessionRef.current = {
        videoId: null,
        title: '',
        startedAtMs: null,
        accumulatedSeconds: 0,
        segmentStartedAtMs: null,
        segmentStartedPlayerSeconds: null,
        durationSeconds: null,
        ranges: [],
      };
      return;
    }

    const durationSeconds = session.durationSeconds && session.durationSeconds > 0
      ? session.durationSeconds
      : null;
    const watchedSeconds = Number(session.accumulatedSeconds.toFixed(1));
    const qualifies = qualifiesAsWatched(watchedSeconds, durationSeconds);

    onWatchSession?.({
      videoId: session.videoId,
      title: session.title || 'Untitled Video',
      startedAt: new Date(session.startedAtMs).toISOString(),
      endedAt: new Date().toISOString(),
      watchedSeconds,
      durationSeconds,
      qualifies,
      ranges: mergeRanges(session.ranges),
    });

    watchSessionRef.current = {
      videoId: null,
      title: '',
      startedAtMs: null,
      accumulatedSeconds: 0,
      segmentStartedAtMs: null,
      segmentStartedPlayerSeconds: null,
      durationSeconds: null,
      ranges: [],
    };
  }, [closeActiveWatchSegment, onWatchSession]);

  useEffect(() => {
    let cancelled = false;
    flushWatchSession(playerRef.current);
    setPlayerDuration(0);
    setPlayerLoadError(null);

    if (!enabled || !videoId || !playerShellRef.current) {
      playerRef.current?.destroy?.();
      playerRef.current = null;
      setPlayerState(null);
      setPlayerDuration(0);
      return;
    }

    loadYouTubeApi().then((YT) => {
      if (cancelled || !playerShellRef.current) return;

      playerRef.current?.destroy?.();
      playerRef.current = null;
      playerShellRef.current.innerHTML = '';

      const mountNode = document.createElement('div');
      mountNode.style.width = '100%';
      mountNode.style.height = '100%';
      mountNode.className = 'yt-player-host';
      playerShellRef.current.appendChild(mountNode);

      playerRef.current = new YT.Player(mountNode, {
        width: '100%',
        height: '100%',
        videoId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: (event: any) => {
            setPlayerLoadError(null);
            const duration = Number(event.target?.getDuration?.() || 0);
            setPlayerDuration(Number.isFinite(duration) ? Math.max(0, Math.floor(duration)) : 0);
            setPlayerState(Number(event.target?.getPlayerState?.() ?? null));
            watchSessionRef.current.durationSeconds = Number.isFinite(duration) ? duration : null;
            const iframe = event.target?.getIframe?.();
            if (iframe) {
              iframe.style.width = '100%';
              iframe.style.height = '100%';
              iframe.style.position = 'absolute';
              iframe.style.inset = '0';
              iframe.style.border = '0';
            }
            playerFrameRef.current?.setAttribute('tabindex', '-1');
          },
          onStateChange: (event: any) => {
            const duration = Number(event.target?.getDuration?.() || 0);
            setPlayerDuration(Number.isFinite(duration) ? Math.max(0, Math.floor(duration)) : 0);
            const nextState = Number(event?.data ?? event.target?.getPlayerState?.() ?? null);
            setPlayerState(nextState);
            watchSessionRef.current.durationSeconds = Number.isFinite(duration) ? duration : null;

            const ytState = window.YT?.PlayerState;
            const session = watchSessionRef.current;
            if (nextState === ytState?.PLAYING) {
              if (!session.videoId) {
                session.videoId = videoId;
                session.title = videoTitle;
                session.startedAtMs = Date.now();
                session.accumulatedSeconds = 0;
                session.ranges = [];
              }
              if (session.segmentStartedAtMs === null) {
                session.segmentStartedAtMs = Date.now();
                const playerSeconds = Number(event.target?.getCurrentTime?.() ?? Number.NaN);
                session.segmentStartedPlayerSeconds = Number.isFinite(playerSeconds) ? playerSeconds : null;
                lastSeenRef.current = Number.isFinite(playerSeconds) ? { playerSeconds, atMs: Date.now() } : null;
              }
              window.setTimeout(() => playerFrameRef.current?.focus({ preventScroll: true }), 0);
            } else {
              closeActiveWatchSegment(event.target);
              if (nextState === ytState?.PAUSED || nextState === ytState?.ENDED) {
                flushWatchSession(event.target);
              }
            }

            const iframe = event.target?.getIframe?.();
            if (iframe) {
              iframe.style.width = '100%';
              iframe.style.height = '100%';
            }
          },
        },
      });
    }).catch((error) => {
      console.error('Failed to initialize YouTube player', error);
      setPlayerLoadError('Unable to load the YouTube player. Check browser tracking/privacy settings and reload the page.');
    });

    return () => {
      cancelled = true;
      flushWatchSession(playerRef.current);
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [closeActiveWatchSegment, enabled, flushWatchSession, videoId, videoTitle]);

  return { playerShellRef, playerFrameRef, playerRef, playerState, playerDuration, playerLoadError };
}
