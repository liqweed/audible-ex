import { describe, expect, test } from 'bun:test'
import { cn } from '@/lib/utils'

describe('cn', () => {
  test('joins class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  test('drops falsy conditional classes', () => {
    expect(cn('foo', { bar: true, baz: false })).toBe('foo bar')
  })

  test('lets a later Tailwind class win over a conflicting one', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })
})
