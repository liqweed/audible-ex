import { describe, expect, test } from 'bun:test'
import { loadBody } from '../../test/content-harness'
import { cardFor, placeAfterTitle, titleOf } from './cards'

const A = 'B000000001'
const B = 'B000000002'
const link = (asin: string, nth = 0) =>
  document.querySelectorAll(`a[href*="${asin}"]`)[nth] as Element

describe('cardFor', () => {
  test('is the largest ancestor that links to one book only', () => {
    loadBody(`<main>
      <div id="a"><div id="a-inner"><a href="/pd/T/${A}">One</a></div></div>
      <div id="b"><a href="/pd/T/${B}">Two</a></div></main>`)
    expect(cardFor(link(A), A)?.id).toBe('a')
    expect(cardFor(link(B), B)?.id).toBe('b')
  })

  test('a known list row is the card, whatever it contains', () => {
    loadBody(`<ul><li class="productListItem" id="row">
      <a href="/pd/T/${A}">One</a><a href="/pd/T/${B}">Two</a></li></ul>`)
    expect(cardFor(link(A), A)?.id).toBe('row')
  })

  test('does not climb out of the body', () => {
    loadBody(`<div id="only"><a href="/pd/T/${A}">One</a></div>`)
    expect(cardFor(link(A), A)?.id).toBe('only')
  })
})

describe('titleOf', () => {
  test('prefers a link in a heading over an earlier plain link', () => {
    loadBody(
      `<div><a href="/pd/T/${A}">Listen now</a><h3><a href="/pd/T/${A}">The Real Title</a></h3></div>`
    )
    expect(titleOf(document.body.firstElementChild as Element, A)).toBe(
      'The Real Title'
    )
  })

  test('else the first text link, with its whitespace squeezed', () => {
    loadBody(`<div><a href="/pd/T/${A}"><img alt="x"></a><a href="/pd/T/${A}">  Two
       Lines </a></div>`)
    expect(titleOf(document.body.firstElementChild as Element, A)).toBe(
      'Two Lines'
    )
  })

  test('leaves popover content out', () => {
    loadBody(
      `<div><div class="bc-popover"><h2><a href="/pd/T/${A}">Popover Title</a></h2></div></div>`
    )
    expect(titleOf(document.body.firstElementChild as Element, A)).toBe('')
  })

  test('a card linked from its cover only takes the cover description', () => {
    loadBody(
      `<div><a href="/pd/T/${A}"><img alt="Alethea Audiobook By Katrina Day, Philomena Polefrone cover art"></a></div>`
    )
    expect(titleOf(document.body.firstElementChild as Element, A)).toBe(
      'Alethea'
    )
    loadBody(
      `<div><a href="/pd/T/${A}"><img alt="Project Hail Mary cover art"></a></div>`
    )
    expect(titleOf(document.body.firstElementChild as Element, A)).toBe(
      'Project Hail Mary'
    )
  })

  test('is empty when the card says nothing', () => {
    loadBody(`<div><a href="/pd/T/${A}"><img></a></div>`)
    expect(titleOf(document.body.firstElementChild as Element, A)).toBe('')
  })
})

describe('placeAfterTitle', () => {
  test('finds a title shown in a span when no link has text (the daily deal)', () => {
    loadBody(
      `<div id="c"><a href="/pd/T/${A}"><img alt="x"></a><div><span>Dune: Book One</span></div></div>`
    )
    const card = document.getElementById('c') as Element
    const wrap = document.createElement('span')
    expect(placeAfterTitle(card, wrap, A, 'Dune', false)).toBe(true)
    expect(wrap.previousElementSibling?.textContent).toBe('Dune: Book One')
  })

  test('reports false when nothing looks like the title', () => {
    loadBody(
      `<div id="c"><a href="/pd/T/${A}"><img></a><p>Something else</p></div>`
    )
    const wrap = document.createElement('span')
    expect(
      placeAfterTitle(
        document.getElementById('c') as Element,
        wrap,
        A,
        'Dune',
        false
      )
    ).toBe(false)
    expect(wrap.parentElement).toBeNull()
  })

  test("does not take the library's Download menu link for the title", () => {
    loadBody(`<div id="c"><a href="/pd/T/${A}">Dune</a>
      <div class="bc-popover"><a href="/library/download?asin=${A}&codec=AAX">Full</a></div></div>`)
    const card = document.getElementById('c') as Element
    const popover = card.querySelector('.bc-popover') as Element
    const wrap = document.createElement('span')
    expect(placeAfterTitle(popover, wrap, A, 'Dune', true)).toBe(false)
    expect(wrap.parentElement).toBeNull()
  })

  test('puts the popover badge after a title link in the popover', () => {
    loadBody(`<div id="c"><a href="/pd/T/${A}">Dune</a>
      <div class="bc-popover"><h2><a href="/pd/T/${A}">Dune</a></h2></div></div>`)
    const popover = document.querySelector('.bc-popover') as Element
    const wrap = document.createElement('span')
    expect(placeAfterTitle(popover, wrap, A, 'Dune', true)).toBe(true)
    expect(wrap.previousElementSibling?.tagName).toBe('H2')
  })
})
