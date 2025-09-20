import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export interface BookData {
  id: string
  title: string
  author: string
  audibleRating: number
  audibleReviewCount: number
  goodreadsRating?: number
  goodreadsReviewCount?: number
  price: number
  originalPrice?: number
  duration: number // in minutes
  releaseDate: string
  series?: string
  seriesPosition?: number
  language: string
  narrator: string[]
  categories: string[]
  imageUrl: string
  url: string
  isAvailable: boolean
  isPreOrder: boolean
  lastUpdated: number
}

export interface CacheEntry {
  data: BookData
  timestamp: number
  domain: string
}

interface CacheState {
  cache: Map<string, CacheEntry>
  maxSize: number
  ttl: number // 7 days in milliseconds

  // Actions
  get: (key: string, domain: string) => BookData | null
  set: (key: string, data: BookData, domain: string) => void
  remove: (key: string) => void
  clear: (domain?: string) => void
  has: (key: string, domain: string) => boolean
  isExpired: (entry: CacheEntry) => boolean
  cleanup: () => void
  getStats: () => { size: number; domains: string[]; oldestEntry: number }
}

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days
const MAX_CACHE_SIZE = 1000

export const useCacheStore = create<CacheState>()(
  devtools(
    (set, get) => ({
      cache: new Map(),
      maxSize: MAX_CACHE_SIZE,
      ttl: CACHE_TTL,

      get: (key, domain) => {
        const entry = get().cache.get(`${domain}:${key}`)
        if (!entry) return null

        if (get().isExpired(entry)) {
          get().remove(key)
          return null
        }

        return entry.data
      },

      set: (key, data, domain) => {
        const cache = new Map(get().cache)
        const fullKey = `${domain}:${key}`

        // Create new entry
        const entry: CacheEntry = {
          data: { ...data, lastUpdated: Date.now() },
          timestamp: Date.now(),
          domain,
        }

        // Add to cache
        cache.set(fullKey, entry)

        // Check if we need to evict entries
        if (cache.size > get().maxSize) {
          // Remove oldest entries (LRU)
          const entries = Array.from(cache.entries())
          entries.sort(([, a], [, b]) => a.timestamp - b.timestamp)

          const toRemove = entries.slice(0, cache.size - get().maxSize + 1)
          toRemove.forEach(([key]) => cache.delete(key))
        }

        set({ cache }, false, 'cache/set')
      },

      remove: key => {
        const cache = new Map(get().cache)
        // Remove from all domains
        const keysToRemove = Array.from(cache.keys()).filter(
          k => k.split(':').slice(1).join(':') === key
        )
        keysToRemove.forEach(k => cache.delete(k))
        set({ cache }, false, 'cache/remove')
      },

      clear: domain => {
        if (domain) {
          const cache = new Map(get().cache)
          const keysToRemove = Array.from(cache.keys()).filter(k =>
            k.startsWith(`${domain}:`)
          )
          keysToRemove.forEach(k => cache.delete(k))
          set({ cache }, false, 'cache/clearDomain')
        } else {
          set({ cache: new Map() }, false, 'cache/clearAll')
        }
      },

      has: (key, domain) => {
        const entry = get().cache.get(`${domain}:${key}`)
        return entry ? !get().isExpired(entry) : false
      },

      isExpired: entry => {
        return Date.now() - entry.timestamp > get().ttl
      },

      cleanup: () => {
        const cache = new Map(get().cache)
        const now = Date.now()

        for (const [key, entry] of cache.entries()) {
          if (now - entry.timestamp > get().ttl) {
            cache.delete(key)
          }
        }

        set({ cache }, false, 'cache/cleanup')
      },

      getStats: () => {
        const cache = get().cache
        const domains = new Set<string>()
        let oldestTimestamp = Date.now()

        for (const entry of cache.values()) {
          domains.add(entry.domain)
          if (entry.timestamp < oldestTimestamp) {
            oldestTimestamp = entry.timestamp
          }
        }

        return {
          size: cache.size,
          domains: Array.from(domains),
          oldestEntry: oldestTimestamp,
        }
      },
    }),
    {
      name: 'CacheStore',
    }
  )
)
