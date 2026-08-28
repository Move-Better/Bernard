import { describe, it, expect } from 'vitest'
import { extractHtmlText, extractHtmlTitle } from '../../api/_lib/citations/htmlText.js'

describe('extractHtmlTitle', () => {
  it('pulls the <title> text', () => {
    expect(extractHtmlTitle('<html><head><title>Low back pain — Mayo Clinic</title></head></html>'))
      .toBe('Low back pain — Mayo Clinic')
  })
  it('returns null when there is no title', () => {
    expect(extractHtmlTitle('<html><body>no title here</body></html>')).toBe(null)
    expect(extractHtmlTitle('')).toBe(null)
  })
  it('decodes entities in the title', () => {
    expect(extractHtmlTitle('<title>Bob &amp; Sue&#39;s Guide</title>')).toBe("Bob & Sue's Guide")
  })
})

describe('extractHtmlText', () => {
  it('strips tags and returns visible text', () => {
    const html = '<html><body><h1>Heading</h1><p>Some <b>bold</b> text.</p></body></html>'
    expect(extractHtmlText(html)).toBe('Heading Some bold text.')
  })

  it('strips <script> and <style> blocks ENTIRELY (not just their tags — their content too)', () => {
    const html = '<html><head><style>.x{color:red}</style></head><body><script>alert(1)</script><p>Real content</p></body></html>'
    const text = extractHtmlText(html)
    expect(text).not.toContain('color:red')
    expect(text).not.toContain('alert(1)')
    expect(text).toContain('Real content')
  })

  it('decodes common entities and collapses whitespace', () => {
    const html = '<p>A &amp; B\n\n\n   C</p>'
    expect(extractHtmlText(html)).toBe('A & B C')
  })

  it('degrades to empty string for empty/garbage input', () => {
    expect(extractHtmlText('')).toBe('')
    expect(extractHtmlText(null)).toBe('')
  })
})
