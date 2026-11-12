import { Fragment } from 'react';
import { splitTimestamps } from '../../lib/timestampLinks';

/** Text with its timestamps as buttons that jump the player there. Keeps the text content unchanged. */
export function TimestampText({ text, onSeek, maxSeconds }: {
  text: string;
  onSeek?: (seconds: number) => void;
  maxSeconds?: number | null;
}) {
  if (!onSeek) return <>{text}</>;
  return (
    <>
      {splitTimestamps(text, maxSeconds).map((segment, index) => (
        segment.kind === 'timestamp' ? (
          <button
            key={index}
            type="button"
            className="timestamp-link"
            onClick={(event) => {
              event.preventDefault();
              onSeek(segment.seconds);
            }}
            title={`Play from ${segment.text}`}
          >
            {segment.text}
          </button>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        )
      ))}
    </>
  );
}
