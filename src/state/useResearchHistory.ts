import { useCallback, useState } from 'react';
import type { ResearchHistoryEvent } from '../types';
import { createHistoryId } from '../lib/researchHistory';

export type NewResearchHistoryEvent = Omit<ResearchHistoryEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string };

/** The research log's event history: what was imported, excluded, tagged, exported... and when. */
export function useResearchHistory(initial: ResearchHistoryEvent[]) {
  const [researchHistory, setResearchHistory] = useState<ResearchHistoryEvent[]>(initial);

  const appendResearchHistory = useCallback((event: NewResearchHistoryEvent) => {
    setResearchHistory((current) => [
      ...current,
      {
        id: event.id || createHistoryId('history'),
        createdAt: event.createdAt || new Date().toISOString(),
        ...event,
      },
    ]);
  }, []);

  /** Marks an event as undone, so the log shows it struck through rather than silently dropping it. */
  const markResearchHistoryEventReverted = useCallback((eventId?: string) => {
    if (!eventId) return;
    setResearchHistory((current) => current.map((event) => (
      event.id === eventId ? { ...event, reverted: true } : event
    )));
  }, []);

  return { researchHistory, setResearchHistory, appendResearchHistory, markResearchHistoryEventReverted };
}
