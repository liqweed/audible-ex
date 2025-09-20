import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export interface FilterCriteria {
  // Rating filters
  minRating: number
  maxRating: number
  minGoodreadsRating: number
  maxGoodreadsRating: number

  // Price filters
  minPrice: number
  maxPrice: number
  freeOnly: boolean
  saleOnly: boolean

  // Content filters
  minDuration: number // in minutes
  maxDuration: number // in minutes
  language: string[]
  narrator: string[]
  categories: string[]

  // Release date filters
  releaseDateFrom: string | null
  releaseDateTo: string | null

  // Series filters
  seriesOnly: boolean
  standaloneOnly: boolean

  // Availability filters
  availableOnly: boolean
  preOrderOnly: boolean
}

interface FilterState {
  criteria: FilterCriteria
  activeFilters: Set<keyof FilterCriteria>
  isFilterPanelOpen: boolean
  sortBy: 'relevance' | 'rating' | 'price' | 'duration' | 'release-date'
  sortDirection: 'asc' | 'desc'

  // Actions
  updateCriteria: (partial: Partial<FilterCriteria>) => void
  resetCriteria: () => void
  addActiveFilter: (key: keyof FilterCriteria) => void
  removeActiveFilter: (key: keyof FilterCriteria) => void
  clearActiveFilters: () => void
  toggleFilterPanel: () => void
  setSortBy: (sortBy: FilterState['sortBy']) => void
  setSortDirection: (direction: FilterState['sortDirection']) => void
  getActiveFilterCount: () => number
}

const defaultCriteria: FilterCriteria = {
  minRating: 0,
  maxRating: 5,
  minGoodreadsRating: 0,
  maxGoodreadsRating: 5,
  minPrice: 0,
  maxPrice: 999,
  freeOnly: false,
  saleOnly: false,
  minDuration: 0,
  maxDuration: 9999,
  language: [],
  narrator: [],
  categories: [],
  releaseDateFrom: null,
  releaseDateTo: null,
  seriesOnly: false,
  standaloneOnly: false,
  availableOnly: false,
  preOrderOnly: false,
}

export const useFilterStore = create<FilterState>()(
  devtools(
    persist(
      (set, get) => ({
        criteria: defaultCriteria,
        activeFilters: new Set(),
        isFilterPanelOpen: false,
        sortBy: 'relevance',
        sortDirection: 'desc',

        updateCriteria: partial =>
          set(
            state => ({
              criteria: { ...state.criteria, ...partial },
            }),
            false,
            'updateCriteria'
          ),

        resetCriteria: () =>
          set(
            {
              criteria: defaultCriteria,
              activeFilters: new Set(),
            },
            false,
            'resetCriteria'
          ),

        addActiveFilter: key =>
          set(
            state => ({
              activeFilters: new Set([...state.activeFilters, key]),
            }),
            false,
            'addActiveFilter'
          ),

        removeActiveFilter: key =>
          set(
            state => {
              const newActiveFilters = new Set(state.activeFilters)
              newActiveFilters.delete(key)
              return { activeFilters: newActiveFilters }
            },
            false,
            'removeActiveFilter'
          ),

        clearActiveFilters: () =>
          set({ activeFilters: new Set() }, false, 'clearActiveFilters'),

        toggleFilterPanel: () =>
          set(
            state => ({ isFilterPanelOpen: !state.isFilterPanelOpen }),
            false,
            'toggleFilterPanel'
          ),

        setSortBy: sortBy => set({ sortBy }, false, 'setSortBy'),

        setSortDirection: direction =>
          set({ sortDirection: direction }, false, 'setSortDirection'),

        getActiveFilterCount: () => get().activeFilters.size,
      }),
      {
        name: 'audible-ex-filter-store',
        partialize: state => ({
          criteria: state.criteria,
          sortBy: state.sortBy,
          sortDirection: state.sortDirection,
        }),
      }
    ),
    {
      name: 'FilterStore',
    }
  )
)
