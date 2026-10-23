import { ViewScope, InclusionView } from '../types';
import { ExplorerFilterModel } from './filterCoordinator';

export type AppNavigationEntry = {
  viewScope: ViewScope;
  inclusionView: InclusionView;
  activeViewId: string | null;
  filterModel: ExplorerFilterModel;
  channelFilterModel: ExplorerFilterModel;
  selectedVideoId: string | null;
  channelId: string | null;
  channelName: string | null;
  videoScopeChannelKeys: string[] | null;
  isChannelDrilldownFilterActive: boolean;
  drilldownPreviousVideoFilter: ExplorerFilterModel | null;
};
