import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { Region, DomainConfig } from '../types/domain'

interface GlobalState {
  // Extension state
  isEnabled: boolean
  currentDomain: string
  currentRegion: Region | null
  domainConfig: DomainConfig | null
  extensionVersion: string

  // UI state
  isLoading: boolean
  error: string | null

  // User preferences
  showGoodreadsRatings: boolean
  showFilters: boolean
  darkMode: boolean

  // Actions
  setEnabled: (enabled: boolean) => void
  setCurrentDomain: (domain: string) => void
  setDomainInfo: (domain: string, region: Region, config: DomainConfig) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  toggleGoodreadsRatings: () => void
  toggleFilters: () => void
  toggleDarkMode: () => void
  resetState: () => void
}

const initialState = {
  isEnabled: true,
  currentDomain: '',
  currentRegion: null,
  domainConfig: null,
  extensionVersion: '1.0.0',
  isLoading: false,
  error: null,
  showGoodreadsRatings: true,
  showFilters: true,
  darkMode: false,
}

export const useGlobalStore = create<GlobalState>()(
  devtools(
    persist(
      set => ({
        ...initialState,

        setEnabled: enabled => set({ isEnabled: enabled }, false, 'setEnabled'),

        setCurrentDomain: domain =>
          set({ currentDomain: domain }, false, 'setCurrentDomain'),

        setDomainInfo: (domain, region, config) =>
          set(
            {
              currentDomain: domain,
              currentRegion: region,
              domainConfig: config,
            },
            false,
            'setDomainInfo'
          ),

        setLoading: loading => set({ isLoading: loading }, false, 'setLoading'),

        setError: error => set({ error }, false, 'setError'),

        toggleGoodreadsRatings: () =>
          set(
            state => ({ showGoodreadsRatings: !state.showGoodreadsRatings }),
            false,
            'toggleGoodreadsRatings'
          ),

        toggleFilters: () =>
          set(
            state => ({ showFilters: !state.showFilters }),
            false,
            'toggleFilters'
          ),

        toggleDarkMode: () =>
          set(
            state => ({ darkMode: !state.darkMode }),
            false,
            'toggleDarkMode'
          ),

        resetState: () => set(initialState, false, 'resetState'),
      }),
      {
        name: 'audible-ex-global-store',
        partialize: state => ({
          isEnabled: state.isEnabled,
          showGoodreadsRatings: state.showGoodreadsRatings,
          showFilters: state.showFilters,
          darkMode: state.darkMode,
        }),
      }
    ),
    {
      name: 'GlobalStore',
    }
  )
)
