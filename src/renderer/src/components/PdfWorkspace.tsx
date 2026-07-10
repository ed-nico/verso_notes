import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { assetUrl } from '../lib/assets'
import { pdfBus } from '../lib/pdfbus'
import { noteBus } from '../lib/notebus'
import { useStore } from '../store'
import { HL_COLORS, type Highlight, type HlRect, loadHighlights, saveHighlights } from '../lib/highlights'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const DEFAULT_SCALE = 1.35
const ZOOM_MIN = 0.6
const ZOOM_MAX = 3
const ZOOM_STEP = 0.2
const round2 = (n: number): number => Math.round(n * 100) / 100

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
}

interface PageDim {
  num: number
  w: number
  h: number
}
interface ToolbarState {
  x: number
  y: number
  page: number
  text: string
  rects: HlRect[]
}
/** Live drag box for area capture, in viewport coordinates. */
interface DragBox {
  left: number
  top: number
  width: number
  height: number
}

function PdfView({
  path,
  highlights,
  scale,
  activeColor,
  auto,
  area,
  onCreate,
  onCreateArea,
  onDelete
}: {
  path: string
  highlights: Highlight[]
  scale: number
  activeColor: string
  auto: boolean
  area: boolean
  onCreate: (hl: Highlight) => void
  onCreateArea: (page: number, dataUrl: string, rect: HlRect) => void
  onDelete: (id: string) => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const pdfRef = useRef<pdfjs.PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  // Page dimensions paired with the scale they were computed at — one coherent value so a
  // zoom updates layout + canvases together (avoids a render race that left pages blank).
  const [doc, setDoc] = useState<{ scale: number; pages: PageDim[] }>({ scale, pages: [] })
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Area-capture drag state: the anchor (in a page's element) plus a live preview box.
  const dragRef = useRef<{ pageEl: HTMLElement; page: number; x0: number; y0: number } | null>(null)
  const [dragBox, setDragBox] = useState<DragBox | null>(null)

  // Load the document (once per path) → number of pages.
  useEffect(() => {
    let cancelled = false
    setDoc((d) => ({ ...d, pages: [] }))
    setNumPages(0)
    setError(null)
    pdfRef.current = null
    const task = pdfjs.getDocument({ url: assetUrl(path) })
    task.promise.then(
      (pdf) => {
        if (cancelled) return
        pdfRef.current = pdf
        setNumPages(pdf.numPages)
      },
      (e) => !cancelled && setError(String(e?.message || e))
    )
    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [path])

  // Compute page dimensions at the current zoom (re-runs on zoom).
  useEffect(() => {
    const pdf = pdfRef.current
    if (!pdf || !numPages) return
    let cancelled = false
    ;(async () => {
      const dims: PageDim[] = []
      for (let n = 1; n <= numPages; n++) {
        const page = await pdf.getPage(n)
        const vp = page.getViewport({ scale })
        dims.push({ num: n, w: vp.width, h: vp.height })
      }
      if (!cancelled) setDoc({ scale, pages: dims })
    })()
    return () => {
      cancelled = true
    }
  }, [numPages, scale])

  // Render canvas + text layer for each page. Keyed on `doc` (scale + dims together) so it
  // fires exactly once per zoom — no stale-pages run to get cancelled and leave blanks.
  useEffect(() => {
    const pdf = pdfRef.current
    const root = containerRef.current
    if (!pdf || !root || doc.pages.length === 0) return
    const docScale = doc.scale
    let cancelled = false
    ;(async () => {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('.pdf-page'))) {
        if (el.dataset.renderedScale === String(docScale)) continue
        const n = Number(el.dataset.page)
        const page = await pdf.getPage(n)
        if (cancelled) return
        const vp = page.getViewport({ scale: docScale })
        const canvas = el.querySelector('canvas')!
        canvas.width = vp.width
        canvas.height = vp.height
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
        if (cancelled) return
        const tl = el.querySelector<HTMLElement>('.textLayer')!
        tl.innerHTML = ''
        try {
          const textLayer = new pdfjs.TextLayer({
            textContentSource: await page.getTextContent(),
            container: tl,
            viewport: vp
          })
          await textLayer.render()
        } catch {
          /* text layer optional */
        }
        el.dataset.renderedScale = String(docScale)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc])

  // Jump-to-highlight from clicks elsewhere.
  useEffect(
    () =>
      pdfBus.subscribe((id) => {
        const el = containerRef.current?.querySelector(`[data-hl-id="${id}"]`)
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
          el.classList.add('hl-flash')
          setTimeout(() => el.classList.remove('hl-flash'), 1200)
        }
      }),
    []
  )

  // ---- text selection → highlight -----------------------------------------
  const createHl = (color: string, t: ToolbarState): void => {
    onCreate({ id: newId(), page: t.page, color, text: t.text, rects: t.rects, createdAt: Date.now() })
    window.getSelection()?.removeAllRanges()
    setToolbar(null)
  }

  const onMouseUp = (e: React.MouseEvent): void => {
    if (area) return finishArea(e)
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setToolbar(null)
      return
    }
    const range = sel.getRangeAt(0)
    const text = sel.toString().trim()
    const pageEl = (range.startContainer.parentElement as HTMLElement | null)?.closest('.pdf-page') as HTMLElement | null
    if (!text || !pageEl) {
      setToolbar(null)
      return
    }
    const pr = pageEl.getBoundingClientRect()
    const rects: HlRect[] = Array.from(range.getClientRects())
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => ({
        left: (r.left - pr.left) / pr.width,
        top: (r.top - pr.top) / pr.height,
        width: r.width / pr.width,
        height: r.height / pr.height
      }))
    if (rects.length === 0) {
      setToolbar(null)
      return
    }
    const clientRects = range.getClientRects()
    const last = clientRects[clientRects.length - 1]
    const t: ToolbarState = { x: last.right, y: last.bottom, page: Number(pageEl.dataset.page), text, rects }
    // Auto mode: make the note immediately with the chosen colour. Otherwise show the
    // colour popup so you can pick per-highlight.
    if (auto) createHl(activeColor, t)
    else setToolbar(t)
  }

  // ---- area capture → image -------------------------------------------------
  const onMouseDown = (e: React.MouseEvent): void => {
    if (!area) return
    const pageEl = (e.target as HTMLElement).closest('.pdf-page') as HTMLElement | null
    if (!pageEl) return
    e.preventDefault()
    dragRef.current = { pageEl, page: Number(pageEl.dataset.page), x0: e.clientX, y0: e.clientY }
    setDragBox({ left: e.clientX, top: e.clientY, width: 0, height: 0 })
  }
  const onMouseMove = (e: React.MouseEvent): void => {
    const d = dragRef.current
    if (!d) return
    setDragBox({
      left: Math.min(d.x0, e.clientX),
      top: Math.min(d.y0, e.clientY),
      width: Math.abs(e.clientX - d.x0),
      height: Math.abs(e.clientY - d.y0)
    })
  }
  const finishArea = (e: React.MouseEvent): void => {
    const d = dragRef.current
    dragRef.current = null
    setDragBox(null)
    // Compute the box from the anchor + release point (not React state, which may not
    // have flushed the last mousemove yet).
    if (!d) return
    const left = Math.min(d.x0, e.clientX)
    const top = Math.min(d.y0, e.clientY)
    const bw = Math.abs(e.clientX - d.x0)
    const bh = Math.abs(e.clientY - d.y0)
    if (bw < 6 || bh < 6) return
    const canvas = d.pageEl.querySelector('canvas')
    if (!canvas) return
    const pr = d.pageEl.getBoundingClientRect()
    // Map the on-screen box to canvas pixels (handles any CSS scaling of the canvas).
    const fx = canvas.width / pr.width
    const fy = canvas.height / pr.height
    const sx = Math.max(0, (left - pr.left) * fx)
    const sy = Math.max(0, (top - pr.top) * fy)
    const sw = Math.min(canvas.width - sx, bw * fx)
    const sh = Math.min(canvas.height - sy, bh * fy)
    if (sw < 4 || sh < 4) return
    const tmp = document.createElement('canvas')
    tmp.width = Math.round(sw)
    tmp.height = Math.round(sh)
    tmp.getContext('2d')!.drawImage(canvas, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height)
    // Page-relative box (fractions) so the captured region also becomes a jump-back highlight.
    const rect: HlRect = {
      left: Math.max(0, (left - pr.left) / pr.width),
      top: Math.max(0, (top - pr.top) / pr.height),
      width: bw / pr.width,
      height: bh / pr.height
    }
    onCreateArea(d.page, tmp.toDataURL('image/png'), rect)
  }

  if (error) {
    return (
      <div className="pdf-view">
        <p className="empty-note" style={{ padding: 24 }}>
          Couldn’t open this PDF: {error}
        </p>
      </div>
    )
  }

  return (
    <div
      className={'pdf-view' + (area ? ' area-mode' : '')}
      ref={containerRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {doc.pages.length === 0 && <p className="empty-note" style={{ padding: 24 }}>Loading PDF…</p>}
      {doc.pages.map((p) => (
        <div
          key={p.num}
          className="pdf-page"
          data-page={p.num}
          style={
            {
              width: p.w,
              height: p.h,
              '--scale-factor': doc.scale,
              '--total-scale-factor': doc.scale
            } as React.CSSProperties
          }
        >
          <canvas />
          <div className="textLayer" />
          <div className="hl-overlay">
            {highlights
              .filter((h) => h.page === p.num)
              .map((h) => (
                <div key={h.id}>
                  {h.rects.map((r, i) => (
                    <div
                      key={i}
                      data-hl-id={i === 0 ? h.id : undefined}
                      className={'hl-rect' + (h.kind === 'area' ? ' area' : '')}
                      style={
                        h.kind === 'area'
                          ? {
                              left: `${r.left * 100}%`,
                              top: `${r.top * 100}%`,
                              width: `${r.width * 100}%`,
                              height: `${r.height * 100}%`,
                              border: `2px solid ${h.color}`,
                              background: h.color + '1f'
                            }
                          : {
                              left: `${r.left * 100}%`,
                              top: `${r.top * 100}%`,
                              width: `${r.width * 100}%`,
                              height: `${r.height * 100}%`,
                              background: h.color + '66'
                            }
                      }
                    />
                  ))}
                  {h.rects[0] && (
                    <button
                      className="hl-del-handle"
                      title="Remove highlight"
                      style={{
                        left: `${(h.rects[0].left + h.rects[0].width) * 100}%`,
                        top: `${h.rects[0].top * 100}%`
                      }}
                      onClick={() => onDelete(h.id)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
      {dragBox && (
        <div
          className="pdf-area-rect"
          style={{ left: dragBox.left, top: dragBox.top, width: dragBox.width, height: dragBox.height }}
        />
      )}
      {toolbar && (
        <div className="hl-toolbar" style={{ left: Math.min(toolbar.x, window.innerWidth - 200), top: toolbar.y + 6 }}>
          {HL_COLORS.map((c) => (
            <button key={c} className="hl-swatch" style={{ background: c }} onMouseDown={(e) => { e.preventDefault(); createHl(c, toolbar) }} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Right side pane: a PDF viewer whose highlights flow into the active note. */
export function PdfWorkspace({
  path,
  width,
  paneIndex
}: {
  path: string
  width?: number
  /** This pane's position among the open splits (so Close closes the right one). */
  paneIndex?: number
}): React.JSX.Element {
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [scale, setScale] = useState(DEFAULT_SCALE)
  const [activeColor, setActiveColor] = useState<string>(() => localStorage.getItem('pdf.hlColor') || HL_COLORS[0])
  const [auto, setAuto] = useState<boolean>(() => localStorage.getItem('pdf.autoNote') !== 'off')
  const [area, setArea] = useState(false)
  const closeSidePane = useStore((s) => s.closeSidePane)

  useEffect(() => {
    let cancelled = false
    loadHighlights(path)
      .then((h) => !cancelled && setHighlights(h))
      .catch((err) => {
        if (!cancelled) {
          console.error(`Failed to load highlights for ${path}:`, err)
          setHighlights([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [path])

  const pickColor = (c: string): void => {
    setActiveColor(c)
    localStorage.setItem('pdf.hlColor', c)
  }
  const toggleAuto = (): void => {
    setAuto((a) => {
      localStorage.setItem('pdf.autoNote', a ? 'off' : 'on')
      return !a
    })
  }

  const mutate = (fn: (prev: Highlight[]) => Highlight[]): void => {
    setHighlights((prev) => {
      const next = fn(prev)
      void saveHighlights(path, next)
      return next
    })
  }

  const insertIntoNote = (md: string): void => {
    const active = useStore.getState().activePath
    if (!active) return
    if (!noteBus.insert(active, md)) {
      const cur = useStore.getState().texts[active] ?? ''
      useStore.getState().editNote(active, cur.replace(/\s*$/, '') + `\n\n${md}\n`)
    }
  }

  const onCreate = (hl: Highlight): void => {
    mutate((p) => [...p, hl])
    const text = hl.text.replace(/\n+/g, ' ').trim()
    insertIntoNote(`- ${text} [p.${hl.page}](hl:${path}#${hl.id})`)
  }

  // Area capture: save the cropped region as an image asset, record it as an 'area'
  // highlight (so a box appears on the page and the note can jump back to it), and embed
  // a capped-width image + jump link in the note — mirroring how text highlights flow in.
  const onCreateArea = async (page: number, dataUrl: string, rect: HlRect): Promise<void> => {
    const base64 = dataUrl.split(',')[1] ?? ''
    const rel = await window.inkwell.saveAsset(`pdf-area-${newId()}.png`, base64)
    if (!rel) return
    const id = newId()
    mutate((p) => [...p, { id, page, color: activeColor, text: `Area — p.${page}`, rects: [rect], kind: 'area', createdAt: Date.now() }])
    const fname = path.split('/').pop()
    insertIntoNote(`- ![${fname} p.${page}|360](${rel}) [p.${page}](hl:${path}#${id})`)
  }

  const name = path.split('/').pop()
  const pct = Math.round((scale / DEFAULT_SCALE) * 100)

  return (
    <div className="pdf-pane" style={width ? { width } : undefined}>
      <div className="pdf-pane-head">
        <span className="pdf-pane-title">{name}</span>
        <button className="icon-btn" title="Close PDF" onClick={() => closeSidePane(paneIndex)}>
          ✕
        </button>
      </div>
      <div className="pdf-toolbar">
        <button className="pdf-tool" title="Zoom out" disabled={scale <= ZOOM_MIN} onClick={() => setScale((s) => Math.max(ZOOM_MIN, round2(s - ZOOM_STEP)))}>
          −
        </button>
        <span className="pdf-zoom" title="Reset zoom" onClick={() => setScale(DEFAULT_SCALE)}>
          {pct}%
        </span>
        <button className="pdf-tool" title="Zoom in" disabled={scale >= ZOOM_MAX} onClick={() => setScale((s) => Math.min(ZOOM_MAX, round2(s + ZOOM_STEP)))}>
          ＋
        </button>
        <span className="pdf-tool-sep" />
        <span className="pdf-tool-label">Highlight</span>
        {HL_COLORS.map((c) => (
          <button
            key={c}
            className={'hl-swatch' + (activeColor === c ? ' active' : '')}
            style={{ background: c }}
            title="Highlight colour"
            onClick={() => pickColor(c)}
          />
        ))}
        <span className="pdf-tool-sep" />
        <button
          className={'pdf-tool toggle' + (auto ? ' on' : '')}
          title="Create a note automatically when you highlight text (otherwise pick a colour each time)"
          onClick={toggleAuto}
        >
          Auto note
        </button>
        <button
          className={'pdf-tool toggle' + (area ? ' on' : '')}
          title="Area highlight — drag a box to capture a region as an image note"
          onClick={() => setArea((a) => !a)}
        >
          ▣ Area
        </button>
      </div>
      <PdfView
        path={path}
        highlights={highlights}
        scale={scale}
        activeColor={activeColor}
        auto={auto}
        area={area}
        onCreate={onCreate}
        onCreateArea={onCreateArea}
        onDelete={(id) => mutate((p) => p.filter((h) => h.id !== id))}
      />
    </div>
  )
}
