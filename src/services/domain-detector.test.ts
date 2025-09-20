import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DomainDetector } from './domain-detector'

describe('DomainDetector', () => {
  let detector: DomainDetector

  beforeEach(() => {
    vi.clearAllMocks()
    detector = DomainDetector.getInstance()
    detector.clearCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getCurrentDomain', () => {
    it('should detect audible.co.uk domain', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.co.uk' },
        writable: true,
      })

      const domain = detector.getCurrentDomain()
      expect(domain).toBe('audible.co.uk')
    })

    it('should detect audible.com domain', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.com' },
        writable: true,
      })

      const domain = detector.getCurrentDomain()
      expect(domain).toBe('audible.com')
    })

    it('should detect audible.ca domain', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.ca' },
        writable: true,
      })

      const domain = detector.getCurrentDomain()
      expect(domain).toBe('audible.ca')
    })

    it('should detect audible.com.au domain', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.com.au' },
        writable: true,
      })

      const domain = detector.getCurrentDomain()
      expect(domain).toBe('audible.com.au')
    })

    it('should detect audible.in domain', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.in' },
        writable: true,
      })

      const domain = detector.getCurrentDomain()
      expect(domain).toBe('audible.in')
    })

    it('should strip www prefix from domain', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'www.audible.co.uk' },
        writable: true,
      })

      const domain = detector.getCurrentDomain()
      expect(domain).toBe('audible.co.uk')
    })

    it('should cache domain after first detection', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.com' },
        writable: true,
      })

      const domain1 = detector.getCurrentDomain()

      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.co.uk' },
        writable: true,
      })

      const domain2 = detector.getCurrentDomain()
      expect(domain1).toBe(domain2)
      expect(domain2).toBe('audible.com')
    })
  })

  describe('getRegion', () => {
    it('should return UK region for audible.co.uk', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.co.uk' },
        writable: true,
      })

      const region = detector.getRegion()
      expect(region).toBe('UK')
    })

    it('should return US region for audible.com', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.com' },
        writable: true,
      })

      const region = detector.getRegion()
      expect(region).toBe('US')
    })

    it('should return CA region for audible.ca', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.ca' },
        writable: true,
      })

      const region = detector.getRegion()
      expect(region).toBe('CA')
    })

    it('should return AU region for audible.com.au', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.com.au' },
        writable: true,
      })

      const region = detector.getRegion()
      expect(region).toBe('AU')
    })

    it('should return IN region for audible.in', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.in' },
        writable: true,
      })

      const region = detector.getRegion()
      expect(region).toBe('IN')
    })
  })

  describe('isSupported', () => {
    it('should return true for supported domains', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.co.uk' },
        writable: true,
      })

      expect(detector.isSupported()).toBe(true)
    })

    it('should return false for unsupported domains', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'example.com' },
        writable: true,
      })

      expect(detector.isSupported()).toBe(false)
    })
  })

  describe('getDomainConfig', () => {
    it('should return correct config for audible.co.uk', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.co.uk' },
        writable: true,
      })

      const config = detector.getDomainConfig()
      expect(config.domain).toBe('audible.co.uk')
      expect(config.region).toBe('UK')
      expect(config.currency).toBe('GBP')
      expect(config.currencySymbol).toBe('£')
      expect(config.dateFormat).toBe('DD/MM/YYYY')
      expect(config.features.plusCatalog).toBe(true)
    })

    it('should return correct config for audible.com', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.com' },
        writable: true,
      })

      const config = detector.getDomainConfig()
      expect(config.domain).toBe('audible.com')
      expect(config.region).toBe('US')
      expect(config.currency).toBe('USD')
      expect(config.currencySymbol).toBe('$')
      expect(config.dateFormat).toBe('MM/DD/YYYY')
      expect(config.features.whispersync).toBe(true)
    })

    it('should return correct config for audible.in', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.in' },
        writable: true,
      })

      const config = detector.getDomainConfig()
      expect(config.domain).toBe('audible.in')
      expect(config.region).toBe('IN')
      expect(config.currency).toBe('INR')
      expect(config.currencySymbol).toBe('₹')
      expect(config.features.plusCatalog).toBe(false)
      expect(config.features.whispersync).toBe(false)
    })

    it('should throw error for unsupported domain', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'example.com' },
        writable: true,
      })

      expect(() => detector.getDomainConfig()).toThrow(
        'Unsupported domain: example.com'
      )
    })

    it('should cache config after first retrieval', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.com' },
        writable: true,
      })

      const config1 = detector.getDomainConfig()
      const config2 = detector.getDomainConfig()
      expect(config1).toBe(config2)
    })
  })

  describe('validateDomain', () => {
    it('should validate supported domains', () => {
      expect(detector.validateDomain('audible.co.uk')).toBe(true)
      expect(detector.validateDomain('audible.com')).toBe(true)
      expect(detector.validateDomain('audible.ca')).toBe(true)
      expect(detector.validateDomain('audible.com.au')).toBe(true)
      expect(detector.validateDomain('audible.in')).toBe(true)
    })

    it('should invalidate unsupported domains', () => {
      expect(detector.validateDomain('example.com')).toBe(false)
      expect(detector.validateDomain('audible.de')).toBe(false)
      expect(detector.validateDomain('audible.fr')).toBe(false)
    })
  })

  describe('clearCache', () => {
    it('should clear cached domain and config', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.com' },
        writable: true,
      })

      const domain1 = detector.getCurrentDomain()
      const config1 = detector.getDomainConfig()

      detector.clearCache()

      Object.defineProperty(window, 'location', {
        value: { hostname: 'audible.co.uk' },
        writable: true,
      })

      const domain2 = detector.getCurrentDomain()
      const config2 = detector.getDomainConfig()

      expect(domain1).toBe('audible.com')
      expect(domain2).toBe('audible.co.uk')
      expect(config1.region).toBe('US')
      expect(config2.region).toBe('UK')
    })
  })

  describe('detectFromTab', () => {
    it('should detect domain from tab URL', async () => {
      const mockTab = {
        url: 'https://www.audible.co.uk/pd/Some-Book/B08XYZABC',
      }

      globalThis.chrome = {
        tabs: {
          get: vi.fn((tabId, callback) => callback(mockTab as any)),
          query: vi.fn(),
        },
      } as any

      const domain = await DomainDetector.detectFromTab(123)
      expect(domain).toBe('audible.co.uk')
    })

    it('should detect domain from active tab when no tabId provided', async () => {
      const mockTab = {
        url: 'https://audible.com/pd/Some-Book/B08XYZABC',
      }

      globalThis.chrome = {
        tabs: {
          query: vi.fn((query, callback) => callback([mockTab] as any)),
          get: vi.fn(),
        },
      } as any

      const domain = await DomainDetector.detectFromTab()
      expect(domain).toBe('audible.com')
    })

    it('should throw error when Chrome API not available', async () => {
      const originalChrome = (globalThis as any).chrome
      ;(globalThis as any).chrome = undefined

      await expect(DomainDetector.detectFromTab()).rejects.toThrow(
        'Chrome API not available'
      )

      ;(globalThis as any).chrome = originalChrome
    })

    it('should throw error when no URL available for tab', async () => {
      const mockTab = {}

      globalThis.chrome = {
        tabs: {
          get: vi.fn((tabId, callback) => callback(mockTab as any)),
          query: vi.fn(),
        },
      } as any

      await expect(DomainDetector.detectFromTab(123)).rejects.toThrow(
        'No URL available for tab'
      )
    })

    it('should throw error when no active tab found', async () => {
      globalThis.chrome = {
        tabs: {
          query: vi.fn((query, callback) => callback([])),
          get: vi.fn(),
        },
      } as any

      await expect(DomainDetector.detectFromTab()).rejects.toThrow(
        'No active tab found'
      )
    })
  })

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = DomainDetector.getInstance()
      const instance2 = DomainDetector.getInstance()
      expect(instance1).toBe(instance2)
    })
  })
})
