import { expect, test } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { App } from './App'

// Proves the happy-dom preload: React renders into a DOM under `bun test`.
test('the popup renders its heading', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'audible-ex' })).toBeDefined()
})
