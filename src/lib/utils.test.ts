import { describe, it, expect } from 'vitest'
import {
  cn,
  formatCurrency,
  debounce,
  throttle,
  safeJsonParse,
  extractDomain,
} from './utils'

describe('utils', () => {
  describe('cn', () => {
    it('should merge class names correctly', () => {
      expect(cn('foo', 'bar')).toBe('foo bar')
      expect(cn('foo', { bar: true, baz: false })).toBe('foo bar')
      expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
    })
  })

  describe('formatCurrency', () => {
    it('should format currency for different regions', () => {
      expect(formatCurrency(10.99, 'com')).toMatch(/\$10\.99/)
      expect(formatCurrency(10.99, 'co.uk')).toMatch(/£10\.99/)
      expect(formatCurrency(10.99, 'ca')).toMatch(/CA\$10\.99/)
      expect(formatCurrency(10.99, 'com.au')).toMatch(/A\$10\.99/)
      expect(formatCurrency(10.99, 'in')).toMatch(/₹10\.99/)
    })

    it('should default to USD for unknown regions', () => {
      expect(formatCurrency(10.99, 'unknown')).toMatch(/\$10\.99/)
    })
  })

  describe('debounce', () => {
    it('should debounce function calls', async () => {
      let callCount = 0
      const debouncedFn = debounce(() => callCount++, 100)

      debouncedFn()
      debouncedFn()
      debouncedFn()

      expect(callCount).toBe(0)

      await new Promise(resolve => setTimeout(resolve, 150))
      expect(callCount).toBe(1)
    })
  })

  describe('throttle', () => {
    it('should throttle function calls', async () => {
      let callCount = 0
      const throttledFn = throttle(() => callCount++, 100)

      throttledFn()
      throttledFn()
      throttledFn()

      expect(callCount).toBe(1)

      await new Promise(resolve => setTimeout(resolve, 150))
      throttledFn()
      expect(callCount).toBe(2)
    })
  })

  describe('safeJsonParse', () => {
    it('should parse valid JSON', () => {
      expect(safeJsonParse('{"foo": "bar"}')).toEqual({ foo: 'bar' })
      expect(safeJsonParse('[1, 2, 3]')).toEqual([1, 2, 3])
    })

    it('should return null for invalid JSON', () => {
      expect(safeJsonParse('invalid json')).toBeNull()
      expect(safeJsonParse('')).toBeNull()
    })
  })

  describe('extractDomain', () => {
    it('should extract domain from URL', () => {
      expect(extractDomain('https://www.audible.com/book/123')).toBe(
        'audible.com'
      )
      expect(extractDomain('https://audible.co.uk/search')).toBe(
        'audible.co.uk'
      )
      expect(extractDomain('https://www.audible.ca')).toBe('audible.ca')
    })

    it('should return empty string for invalid URLs', () => {
      expect(extractDomain('invalid-url')).toBe('')
      expect(extractDomain('')).toBe('')
    })
  })
})
