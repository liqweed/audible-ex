/**
 * `value` with the key `from` renamed to `to` wherever it occurs, however deep: a stand-in for a
 * source renaming a field. Schema tests use it to check that the decode error names the field.
 */
export function renameKey(value: unknown, from: string, to: string): unknown {
  if (Array.isArray(value)) return value.map(item => renameKey(item, from, to))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key === from ? to : key,
      renameKey(item, from, to),
    ])
  )
}
