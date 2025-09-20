export { useGlobalStore } from './global-store'
export { useFilterStore, type FilterCriteria } from './filter-store'
export { useCacheStore, type BookData, type CacheEntry } from './cache-store'

// Combined store selectors for common use cases
import { useGlobalStore } from './global-store'
import { useFilterStore } from './filter-store'
import { useCacheStore } from './cache-store'

export const useExtensionEnabled = () =>
  useGlobalStore(state => state.isEnabled)
export const useCurrentDomain = () =>
  useGlobalStore(state => state.currentDomain)
export const useTheme = () => useGlobalStore(state => state.darkMode)
export const useFilterCount = () =>
  useFilterStore(state => state.getActiveFilterCount())
export const useCacheStats = () => useCacheStore(state => state.getStats())
