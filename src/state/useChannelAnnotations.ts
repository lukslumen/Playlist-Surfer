import { useCallback, useState } from 'react';
import {
  addTagToChannels,
  appendChannelNotes,
  removeTagFromChannels,
  replaceChannelTags,
  setChannelNote,
} from '../lib/channelMetadata';

/** Researcher notes and tags on channels, keyed by channel key. */
export function useChannelAnnotations(initial: { notes?: Record<string, string>; tags?: Record<string, string[]> }) {
  const [channelNotesById, setChannelNotesById] = useState<Record<string, string>>(initial.notes ?? {});
  const [channelTagsById, setChannelTagsById] = useState<Record<string, string[]>>(initial.tags ?? {});

  const handleUpdateChannelNotes = useCallback((channelKey: string, notes: string) => {
    setChannelNotesById((previous) => setChannelNote(previous, channelKey, notes));
  }, []);

  const handleReplaceChannelTags = useCallback((channelKey: string, tags: string[]) => {
    setChannelTagsById((previous) => replaceChannelTags(previous, channelKey, tags));
  }, []);

  const addTagToChannelKeys = useCallback((channelKeys: string[], tag: string) => {
    setChannelTagsById((previous) => addTagToChannels(previous, channelKeys, tag));
  }, []);

  const removeTagFromChannelKeys = useCallback((channelKeys: string[], tag: string) => {
    setChannelTagsById((previous) => removeTagFromChannels(previous, channelKeys, tag));
  }, []);

  /** Appends a note block to each channel; returns the result message shown in the panel. */
  const appendNotesToChannelKeys = useCallback((channelKeys: string[], notes: string) => {
    const noteBlock = String(notes || '').trim();
    if (!noteBlock) return { status: 'empty' as const, appliedCount: 0, message: 'Enter a note before applying.' };
    if (!channelKeys.length) return { status: 'empty' as const, appliedCount: 0, message: 'No selected channels to update.' };
    setChannelNotesById((previous) => appendChannelNotes(previous, channelKeys, noteBlock));
    return {
      status: 'success' as const,
      appliedCount: channelKeys.length,
      message: `Applied notes to ${channelKeys.length.toLocaleString()} channel(s).`,
    };
  }, []);

  return {
    channelNotesById,
    setChannelNotesById,
    channelTagsById,
    setChannelTagsById,
    handleUpdateChannelNotes,
    handleReplaceChannelTags,
    addTagToChannelKeys,
    removeTagFromChannelKeys,
    appendNotesToChannelKeys,
  };
}
