import { useEffect } from 'react';
import { useOfflinePackStore } from '../stores/offlinePackStore';

/** Share one download between manual controls and desktop installation. */
export function useOfflinePack() {
  const state = useOfflinePackStore();
  const { refresh } = state;
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { ...state, isComplete: state.cached >= state.total };
}
