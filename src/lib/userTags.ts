import { Annotation } from '../types';

export type UserTagsState = Record<string, string[]>;

type UserTagAction =
  | { type: 'hydrate'; state: UserTagsState }
  | { type: 'replaceForVideo'; videoId: string; tags: string[] }
  | { type: 'addTagToVideos'; videoIds: string[]; tag: string }
  | { type: 'removeTagFromVideos'; videoIds: string[]; tag: string };

function normalizeTags(tags: string[]) {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
}

export function extractUserTagsFromAnnotations(annotations: Record<string, Annotation> = {}): UserTagsState {
  return Object.fromEntries(
    Object.entries(annotations)
      .map(([videoId, annotation]) => [videoId, normalizeTags(annotation?.tags ?? [])] as const)
      .filter(([, tags]) => tags.length > 0),
  );
}

export function stripTagsFromAnnotations(annotations: Record<string, Annotation> = {}): Record<string, Annotation> {
  return Object.fromEntries(
    Object.entries(annotations).map(([videoId, annotation]) => [
      videoId,
      {
        ...annotation,
        tags: [],
      },
    ]),
  );
}

export function mergeAnnotationsWithUserTags(
  annotations: Record<string, Annotation> = {},
  userTagsByVideoId: UserTagsState = {},
): Record<string, Annotation> {
  const videoIds = new Set([...Object.keys(annotations), ...Object.keys(userTagsByVideoId)]);
  return Object.fromEntries(
    Array.from(videoIds).map((videoId) => {
      const annotation = annotations[videoId];
      return [
        videoId,
        {
          tags: userTagsByVideoId[videoId] ?? [],
          transcriptOverride: annotation?.transcriptOverride,
          quoteRefs: annotation?.quoteRefs ?? [],
          timestampRefs: annotation?.timestampRefs ?? [],
        } satisfies Annotation,
      ];
    }),
  );
}

export function userTagsReducer(state: UserTagsState, action: UserTagAction): UserTagsState {
  switch (action.type) {
    case 'hydrate':
      return action.state;
    case 'replaceForVideo': {
      const nextTags = normalizeTags(action.tags);
      if (nextTags.length === 0) {
        if (!(action.videoId in state)) return state;
        const nextState = { ...state };
        delete nextState[action.videoId];
        return nextState;
      }
      const currentTags = state[action.videoId] ?? [];
      if (currentTags.length === nextTags.length && currentTags.every((tag, index) => tag === nextTags[index])) {
        return state;
      }
      return { ...state, [action.videoId]: nextTags };
    }
    case 'addTagToVideos': {
      const nextTag = action.tag.trim();
      if (!nextTag || action.videoIds.length === 0) return state;

      let changed = false;
      const nextState = { ...state };
      action.videoIds.forEach((videoId) => {
        const currentTags = state[videoId] ?? [];
        if (currentTags.includes(nextTag)) return;
        nextState[videoId] = [...currentTags, nextTag];
        changed = true;
      });
      return changed ? nextState : state;
    }
    case 'removeTagFromVideos': {
      const targetTag = action.tag.trim();
      if (!targetTag || action.videoIds.length === 0) return state;

      let changed = false;
      const nextState = { ...state };
      action.videoIds.forEach((videoId) => {
        const currentTags = state[videoId] ?? [];
        if (!currentTags.includes(targetTag)) return;
        const filtered = currentTags.filter((tag) => tag !== targetTag);
        if (filtered.length === 0) {
          delete nextState[videoId];
        } else {
          nextState[videoId] = filtered;
        }
        changed = true;
      });
      return changed ? nextState : state;
    }
    default:
      return state;
  }
}
