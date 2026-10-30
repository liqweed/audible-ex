import { describe, expect, test } from 'bun:test'
import { htmlToText, truncate } from '@/core/html'

describe('htmlToText', () => {
  test('turns <br> into a line break and </p> into a blank line', () => {
    expect(htmlToText('One<br />Two<BR>Three</p><p>Four</p>Five')).toBe(
      'One\nTwo\nThree\n\nFour\n\nFive'
    )
  })

  test('drops other tags and keeps their text', () => {
    expect(
      htmlToText('<b>The Name of the Wind</b> is a <i>masterpiece</i>.')
    ).toBe('The Name of the Wind is a masterpiece.')
  })

  test('shrinks three or more line breaks to a blank line', () => {
    expect(htmlToText('A<br /><br /><br /><br />B')).toBe('A\n\nB')
  })

  test('decodes named, decimal and hexadecimal entities', () => {
    expect(
      htmlToText('Pat&#39;s &quot;tale&quot; &amp; more &#x2014; &hellip;')
    ).toBe('Pat\'s "tale" & more — …')
  })

  test('decodes once: an escaped entity stays an entity', () => {
    expect(htmlToText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;')
  })

  test('leaves unknown and out-of-range entities as written', () => {
    expect(htmlToText('&bogus; &#0; &#x110000;')).toBe(
      '&bogus; &#0; &#x110000;'
    )
  })

  test('missing input is the empty string', () => {
    expect(htmlToText(undefined)).toBe('')
    expect(htmlToText(null)).toBe('')
    expect(htmlToText('  <br />  ')).toBe('')
  })
})

describe('truncate', () => {
  test('keeps short text as it is', () => {
    expect(truncate('abc', 3)).toBe('abc')
  })

  test('cuts to the limit', () => {
    expect(truncate('abcdef', 4)).toBe('abcd')
  })

  test('does not leave half of a surrogate pair', () => {
    expect(truncate('ab😀cd', 3)).toBe('ab')
    expect(truncate('ab😀cd', 4)).toBe('ab😀')
  })
})
