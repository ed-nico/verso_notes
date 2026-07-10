import React, { useRef, useState } from 'react'
import { parseTarget } from '../lib/links'
import { assetUrl } from '../lib/assets'
import { openLinkTarget } from '../lib/openLink'
import { spellStatus } from '../lib/spell'
import { hoverLink, unhoverLink } from './LinkPreview'

interface RenderOpts {
  isResolved: (raw: string) => boolean
  onNavigate: (raw: string, newTab?: boolean) => void
  /** Optional: clicking a #tag opens the tag view. */
  onTag?: (tag: string) => void
  /** Optional: the supertag (display name) a linked entity carries, if any. */
  supertagOf?: (rawPage: string) => string | undefined
  /** Optional: clicking a typed entity expands its fields inline (x/y = click position). */
  onExpandEntity?: (rawPage: string, x: number, y: number) => void
  /** When true, links don't fire the ⌘-hover preview (used inside the preview itself). */
  noPreview?: boolean
  /** When true, underline misspelled words in plain-text runs (rendered blocks only). */
  spellcheck?: boolean
  /** Optional: right-clicking a misspelled word (x/y = click position). */
  onMisspelling?: (word: string, x: number, y: number) => void
  /** Optional: images get a drag handle; called with the raw src + new width on release. */
  onImageResize?: (src: string, width: number) => void
}

/** An inline image with an optional drag-to-resize handle (bottom-right, on hover). */
function ResizableImage({
  src,
  rawSrc,
  alt,
  width,
  onResize
}: {
  src: string
  rawSrc: string
  alt: string
  width?: number
  onResize?: (src: string, width: number) => void
}): React.JSX.Element {
  const imgRef = useRef<HTMLImageElement>(null)
  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const img = imgRef.current
    if (!img) return
    const startX = e.clientX
    const startW = img.getBoundingClientRect().width
    let w = Math.round(startW)
    const onMove = (ev: MouseEvent): void => {
      w = Math.max(60, Math.round(startW + ev.clientX - startX))
      setLiveWidth(w)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      setLiveWidth(null)
      onResize?.(rawSrc, w)
    }
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
  const w = liveWidth ?? width
  return (
    <span className="img-wrap">
      <img
        ref={imgRef}
        className="inline-img"
        src={src}
        alt={alt}
        style={w ? { width: w, maxWidth: '100%', height: 'auto' } : undefined}
        draggable={false}
      />
      {onResize && (
        <span className="img-resize-handle" title="Drag to resize" onMouseDown={startResize} />
      )}
    </span>
  )
}

const WORD_TOKEN_RE = /[A-Za-z][A-Za-z']*/g

// ![alt](src) | [text](url) | [[wikilink]] | `code` | **bold** | *italic* | _italic_ | #tag | bare URL | ~~strike~~
const MD_RE =
  /!\[([^\]\n]*)\]\(([^)\n]+)\)|\[([^\]\n]+?)\]\(([^)\n]+)\)|\[\[([^\]\n]+?)\]\]|(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\*[^*\n]+?\*)|(?<![A-Za-z0-9])_([^_\n]+?)_(?![A-Za-z0-9])|(?<=^|\s)#([\p{L}\d_][\p{L}\d_/-]*)|(https?:\/\/[^\s<>]+)|(~~[^~\n]+?~~)/gu

/** Render inline Markdown of a single block to React nodes (recurses for nesting). */
export function renderInline(text: string, opts: RenderOpts): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  // A fresh regex per call so recursion doesn't clobber a shared lastIndex.
  const re = new RegExp(MD_RE.source, MD_RE.flags)

  // Push a plain-text run, underlining misspelled words when spellcheck is on.
  const pushText = (s: string): void => {
    if (!s) return
    if (!opts.spellcheck) {
      nodes.push(s)
      return
    }
    let lo = 0
    let wm: RegExpExecArray | null
    WORD_TOKEN_RE.lastIndex = 0
    while ((wm = WORD_TOKEN_RE.exec(s))) {
      const word = wm[0]
      if (spellStatus(word) !== true) continue
      if (wm.index > lo) nodes.push(s.slice(lo, wm.index))
      nodes.push(
        <span
          key={key++}
          className="cm-misspelled"
          // Stop a right-click from bubbling to the row (which would swap the block into
          // edit mode on mousedown and unmount this span before `contextmenu` fires).
          onMouseDown={opts.onMisspelling ? (e) => e.button === 2 && e.stopPropagation() : undefined}
          onContextMenu={
            opts.onMisspelling
              ? (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  opts.onMisspelling!(word, e.clientX, e.clientY)
                }
              : undefined
          }
        >
          {word}
        </span>
      )
      lo = wm.index + word.length
    }
    if (lo < s.length) nodes.push(s.slice(lo))
  }

  while ((m = re.exec(text))) {
    if (m.index > last) pushText(text.slice(last, m.index))

    if (m[2] !== undefined) {
      // image: ![width](src) or ![alt|width](src). A numeric alt = max width in px.
      const [first, second] = m[1].split('|')
      const numeric = (s?: string): number | undefined =>
        s && /^\d+$/.test(s.trim()) ? Number(s.trim()) : undefined
      const width = numeric(first) ?? numeric(second)
      const alt = numeric(first) !== undefined ? (second ?? '') : first
      nodes.push(
        <ResizableImage
          key={key++}
          src={assetUrl(m[2])}
          rawSrc={m[2]}
          alt={alt}
          width={width}
          onResize={opts.onImageResize}
        />
      )
    } else if (m[4] !== undefined) {
      // [text](url) markdown link
      const label = m[3]
      const url = m[4]
      nodes.push(
        <span
          key={key++}
          className="md-link"
          role="link"
          tabIndex={0}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            openLinkTarget(url)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              openLinkTarget(url)
            }
          }}
        >
          {label}
        </span>
      )
    } else if (m[5] !== undefined) {
      // wikilink
      const body = m[5]
      const pipe = body.indexOf('|')
      const linkPart = pipe === -1 ? body : body.slice(0, pipe)
      const alias = pipe === -1 ? null : body.slice(pipe + 1).trim() || null
      const rawPage = parseTarget(linkPart).page
      const resolved = opts.isResolved(rawPage)
      const entityType = resolved ? opts.supertagOf?.(rawPage) : undefined
      if (entityType && opts.onExpandEntity) {
        // A linked note that carries a supertag → typed entity chip. Click expands its
        // fields inline; ⌘/Ctrl-click navigates to the entity's page.
        nodes.push(
          <span
            key={key++}
            className="cm-entity"
            role="button"
            tabIndex={0}
            title={`${rawPage} · ${entityType} — click to expand`}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (e.metaKey || e.ctrlKey) opts.onNavigate(linkPart, true)
              else opts.onExpandEntity!(rawPage, e.clientX, e.clientY)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                const r = (e.target as HTMLElement).getBoundingClientRect()
                if (e.metaKey || e.ctrlKey) opts.onNavigate(linkPart, true)
                else opts.onExpandEntity!(rawPage, r.left, r.bottom)
              }
            }}
          >
            {alias ?? linkPart}
            <span className="entity-badge">{entityType}</span>
          </span>
        )
      } else {
        nodes.push(
          <span
            key={key++}
            className={'cm-wikilink' + (resolved ? '' : ' unresolved')}
            role="link"
            tabIndex={0}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              opts.onNavigate(linkPart, e.metaKey || e.ctrlKey)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                opts.onNavigate(linkPart, e.metaKey || e.ctrlKey)
              }
            }}
            onMouseEnter={opts.noPreview ? undefined : (e) => resolved && hoverLink(rawPage, e.clientX, e.clientY)}
            onMouseLeave={opts.noPreview ? undefined : () => unhoverLink()}
          >
            {alias ?? body}
          </span>
        )
      }
    } else if (m[6] !== undefined) {
      nodes.push(
        <code key={key++} className="tok-code">
          {m[6].slice(1, -1)}
        </code>
      )
    } else if (m[7] !== undefined) {
      nodes.push(<strong key={key++}>{renderInline(m[7].slice(2, -2), opts)}</strong>)
    } else if (m[8] !== undefined) {
      nodes.push(<em key={key++}>{renderInline(m[8].slice(1, -1), opts)}</em>)
    } else if (m[9] !== undefined) {
      nodes.push(<em key={key++}>{renderInline(m[9], opts)}</em>)
    } else if (m[10] !== undefined) {
      const tag = m[10]
      nodes.push(
        <span
          key={key++}
          className={'cm-tag' + (opts.onTag ? ' clickable' : '')}
          role={opts.onTag ? 'button' : undefined}
          tabIndex={opts.onTag ? 0 : undefined}
          onMouseDown={
            opts.onTag
              ? (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  opts.onTag!(tag)
                }
              : undefined
          }
          onKeyDown={
            opts.onTag
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    opts.onTag!(tag)
                  }
                }
              : undefined
          }
        >
          #{tag}
        </span>
      )
    } else if (m[11] !== undefined) {
      // Bare URL → autolink. Trailing sentence punctuation is kept out of the link.
      let url = m[11]
      let trail = ''
      const tm = url.match(/[.,;:!?)\]'"]+$/)
      if (tm) {
        trail = tm[0]
        url = url.slice(0, -trail.length)
      }
      const href = url
      nodes.push(
        <span
          key={key++}
          className="md-link"
          role="link"
          tabIndex={0}
          title={href}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            openLinkTarget(href)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              openLinkTarget(href)
            }
          }}
        >
          {url}
        </span>
      )
      if (trail) nodes.push(trail)
    } else if (m[12] !== undefined) {
      nodes.push(<del key={key++}>{renderInline(m[12].slice(2, -2), opts)}</del>)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) pushText(text.slice(last))
  return nodes
}
