import type {
  Annotation,
  AppState,
  ChannelLinkingState,
  ChannelMetadataSnapshot,
  ColumnLineageState,
  DashboardScope,
  DatasetDashboardSnapshot,
  ExcludedVideoMeta,
  GeneratedMetadataState,
  ImportedChannelMetadataState,
  InclusionView,
  LinkingState,
  ResearchHistoryEvent,
  ResearchLogCommentSectionId,
  RowLineageState,
  SavedView,
  SavedViewDashboardSnapshot,
  SourceRegistryState,
  SourceVisibilityState,
  SpecialMappings,
  ViewScope,
  WatchHistoryEntry,
} from '../types';
import type { ExplorerFilterModel } from './filterCoordinator';

/** Everything needed to (re)build the in-app project: from a CSV import, a merge or a backup. */
export interface HydrateProjectArgs {
  rows: any[];
  schema?: any[];
  fileName: string | null;
  visible?: string[];
  channelVisible?: string[];
  videoColumnWidths?: Record<string, number>;
  vernacularExclusions?: string[];
  channelColumnWidths?: Record<string, number>;
  annotations?: Record<string, Annotation>;
  notesByVideoId?: Record<string, string>;
  channelNotesById?: Record<string, string>;
  channelTagsById?: Record<string, string[]>;
  savedViews?: SavedView[];
  activeViewId?: string | null;
  projectOverview?: string;
  projectNotes?: string;
  researchLogSectionComments?: Partial<Record<ResearchLogCommentSectionId, string>>;
  researchHistory?: ResearchHistoryEvent[];
  watchHistoryByVideoId?: Record<string, WatchHistoryEntry>;
  theme?: AppState['theme'];
  isRightPanelCollapsed?: boolean;
  deletedColumns?: string[];
  specialMappings?: Partial<SpecialMappings>;
  excludedVideoIds?: string[];
  excludedVideoMetaById?: Record<string, ExcludedVideoMeta>;
  inclusionView?: InclusionView;
  dashboardSnapshots?: Partial<Record<DashboardScope, DatasetDashboardSnapshot>>;
  savedViewDashboardSnapshots?: Record<string, SavedViewDashboardSnapshot>;
  savedViewsVersion?: number;
  channelMetadataSnapshot?: ChannelMetadataSnapshot | null;
  importedChannelMetadata?: ImportedChannelMetadataState | null;
  viewScope?: ViewScope;
  channelFilterModel?: ExplorerFilterModel;
  channelSnapshotShouldBeFresh?: boolean;
  autoExpandPanel?: boolean;
  sourceRegistry?: SourceRegistryState;
  sourceVisibility?: SourceVisibilityState;
  rowLineage?: RowLineageState;
  columnLineage?: ColumnLineageState;
  generatedMetadata?: GeneratedMetadataState;
  linkingState?: LinkingState;
  channelLinkingState?: ChannelLinkingState;
}
