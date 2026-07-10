import { describe, it, expect } from 'vitest'
import { parseVideoUrl, embedUrl, formatTimestamp, parseTimestamp } from './video'

describe('parseVideoUrl', () => {
  it('parses YouTube watch / short / youtu.be URLs', () => {
    expect(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({ provider: 'youtube', id: 'dQw4w9WgXcQ' })
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toMatchObject({ provider: 'youtube', id: 'dQw4w9WgXcQ' })
    expect(parseVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toMatchObject({ provider: 'youtube', id: 'dQw4w9WgXcQ' })
  })

  it('parses a YouTube start time (t=) in seconds and 1h2m3s form', () => {
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=90')?.start).toBe(90)
    expect(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s')?.start).toBe(3723)
  })

  it('parses Vimeo and Loom', () => {
    expect(parseVideoUrl('https://vimeo.com/123456789')).toMatchObject({ provider: 'vimeo', id: '123456789' })
    expect(parseVideoUrl('https://www.loom.com/share/abc123def456')).toMatchObject({ provider: 'loom', id: 'abc123def456' })
  })

  it('returns null for non-video URLs', () => {
    expect(parseVideoUrl('https://opencode.ai/')).toBeNull()
    expect(parseVideoUrl('https://example.com/watch?v=nope')).toBeNull()
  })

  it('builds an embed URL with the JS API enabled', () => {
    const u = embedUrl({ provider: 'youtube', id: 'abc12345678', start: 30 })
    expect(u).toContain('youtube.com/embed/abc12345678')
    expect(u).toContain('enablejsapi=1')
    expect(u).toContain('start=30')
  })
})

describe('timestamp formatting', () => {
  it('formats seconds to m:ss / h:mm:ss', () => {
    expect(formatTimestamp(5)).toBe('0:05')
    expect(formatTimestamp(75)).toBe('1:15')
    expect(formatTimestamp(3723)).toBe('1:02:03')
  })
  it('parses m:ss / h:mm:ss / raw seconds back', () => {
    expect(parseTimestamp('1:15')).toBe(75)
    expect(parseTimestamp('1:02:03')).toBe(3723)
    expect(parseTimestamp('90')).toBe(90)
    expect(parseTimestamp('nope')).toBeNull()
  })
})
