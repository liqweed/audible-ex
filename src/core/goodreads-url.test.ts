import { expect, test } from 'bun:test'
import { goodreadsBookId } from './goodreads-url'

test.each([
  'https://www.goodreads.com/book/show/54493401-project-hail-mary?from_search=true',
  ' https://goodreads.com/book/show/54493401.Project_Hail_Mary#reviews ',
  'https://www.goodreads.com/book/show/54493401/',
])('extracts only the id from %s', input =>
  expect(goodreadsBookId(input)).toBe('54493401')
)
test.each([
  'http://www.goodreads.com/book/show/1',
  'https://goodreads.com.evil.test/book/show/1',
  'https://evil.test/book/show/1',
  'https://www.goodreads.com:8443/book/show/1',
  'https://me:secret@goodreads.com/book/show/1',
  'https://goodreads.com/book/show/1/extra',
  'https://goodreads.com/book/show/nope',
  'javascript:alert(1)',
  '1',
])('rejects %s', input => expect(() => goodreadsBookId(input)).toThrow())
