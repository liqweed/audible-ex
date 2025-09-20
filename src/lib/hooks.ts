import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { fetchGoodreadsData, type BookSearchParams } from './api'
import { useCacheStore, useGlobalStore, type BookData } from '../stores'

/**
 * Hook to fetch Goodreads data for a book
 */
export function useGoodreadsData(params: BookSearchParams | null) {
  return useQuery({
    queryKey: ['goodreads', params],
    queryFn: () => (params ? fetchGoodreadsData(params) : null),
    enabled: !!params,
    staleTime: 24 * 60 * 60 * 1000, // 24 hours
    gcTime: 7 * 24 * 60 * 60 * 1000, // 7 days
  })
}

/**
 * Hook to manage extension settings
 */
export function useExtensionSettings() {
  const {
    isEnabled,
    showGoodreadsRatings,
    showFilters,
    darkMode,
    setEnabled,
    toggleGoodreadsRatings,
    toggleFilters,
    toggleDarkMode,
  } = useGlobalStore()

  return {
    settings: {
      isEnabled,
      showGoodreadsRatings,
      showFilters,
      darkMode,
    },
    actions: {
      setEnabled,
      toggleGoodreadsRatings,
      toggleFilters,
      toggleDarkMode,
    },
  }
}

/**
 * Hook to manage cache operations
 */
export function useCache() {
  const { get, set, remove, clear, cleanup, getStats } = useCacheStore()
  const currentDomain = useGlobalStore(state => state.currentDomain)

  const getCachedData = useCallback(
    (key: string) => get(key, currentDomain),
    [get, currentDomain]
  )

  const setCachedData = useCallback(
    (key: string, data: BookData) => set(key, data, currentDomain),
    [set, currentDomain]
  )

  const clearDomainCache = useCallback(
    () => clear(currentDomain),
    [clear, currentDomain]
  )

  return {
    get: getCachedData,
    set: setCachedData,
    remove,
    clear: clearDomainCache,
    clearAll: () => clear(),
    cleanup,
    stats: getStats(),
  }
}

/**
 * Hook to manage current tab and domain detection
 */
export function useCurrentTab() {
  const [currentTab, setCurrentTab] = useState<chrome.tabs.Tab | null>(null)
  const setCurrentDomain = useGlobalStore(state => state.setCurrentDomain)

  useEffect(() => {
    // Get current active tab
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0]
      if (tab) {
        setCurrentTab(tab)
        if (tab.url) {
          const domain = new URL(tab.url).hostname.replace('www.', '')
          setCurrentDomain(domain)
        }
      }
    })

    // Listen for tab updates
    const handleTabUpdate = (
      tabId: number,
      changeInfo: any,
      tab: chrome.tabs.Tab
    ) => {
      if (changeInfo.url && tab.active) {
        setCurrentTab(tab)
        const domain = new URL(changeInfo.url).hostname.replace('www.', '')
        setCurrentDomain(domain)
      }
    }

    chrome.tabs.onUpdated.addListener(handleTabUpdate)
    return () => chrome.tabs.onUpdated.removeListener(handleTabUpdate)
  }, [setCurrentDomain])

  return currentTab
}

/**
 * Hook to detect if we're on a supported Audible domain
 */
export function useAudibleDomain() {
  const currentDomain = useGlobalStore(state => state.currentDomain)

  const supportedDomains = [
    'audible.com',
    'audible.co.uk',
    'audible.ca',
    'audible.com.au',
    'audible.in',
  ]

  const isAudibleDomain = supportedDomains.includes(currentDomain)
  const region = currentDomain.split('.').slice(-1)[0] // Extract region from domain

  return {
    isAudibleDomain,
    currentDomain,
    region,
    supportedDomains,
  }
}

/**
 * Hook for debounced search functionality
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}
