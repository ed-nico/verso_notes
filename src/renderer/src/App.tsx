import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore, EDITOR_FONTS, ACCENTS, type SidePane } from './store'
import { Sidebar } from './components/Sidebar'
import { Backlinks } from './components/Backlinks'
import { GraphView } from './components/GraphView'
import { BasesView } from './components/BasesView'
import { AssetsView } from './components/AssetsView'
import { TagsView } from './components/TagsView'
import { BlockEditor } from './components/BlockEditor'
import { NoteTitle } from './components/NoteTitle'
import { PropertiesPanel } from './components/PropertiesPanel'
import { LocalGraph } from './components/LocalGraph'
import { TableOfContents } from './components/TableOfContents'
import { JournalView } from './components/JournalView'
import { Calendar } from './components/Calendar'
import { TodosView } from './components/TodosView'
import { CommandPalette } from './components/CommandPalette'
import { Settings } from './components/Settings'
import { Help } from './components/Help'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LinkPreview } from './components/LinkPreview'
import { ContextMenu } from './components/ContextMenu'
import { noteStats } from './lib/stats'
import { REVEAL_LABEL } from './lib/platform'

// pdfjs-dist (+ its worker) is large and only needed when a PDF opens — load it lazily.
const PdfWorkspace = lazy(() => import('./components/PdfWorkspace').then((m) => ({ default: m.PdfWorkspace })))
// The canvas surface is only needed in the Canvas view — load it lazily too.
const CanvasView = lazy(() => import('./components/CanvasView').then((m) => ({ default: m.CanvasView })))

function Welcome(): React.JSX.Element {
  const openWorkspace = useStore((s) => s.openWorkspace)
  return (
    <div className="welcome">
      <h1>Verso</h1>
      <p>
        A local-first notebook — Markdown files, an outliner, a journal, todos, backlinks, and a
        graph. Open a folder to begin; everything stays on your disk as plain <code>.md</code>.
      </p>
      <button className="btn" onClick={() => void openWorkspace()}>
        Open a folder
      </button>
    </div>
  )
}

const VIEW_TITLE: Record<string, string> = {
  graph: 'Graph',
  canvas: 'Canvas',
  database: 'Bases',
  journal: 'Journal',
  todos: 'Todos',
  assets: 'Assets',
  tags: 'Tags'
}

function TopBar(): React.JSX.Element {
  const view = useStore((s) => s.view)
  const activePath = useStore((s) => s.activePath)
  const files = useStore((s) => s.files)
  // Only the active note's text — so the word count doesn't re-render when other notes change.
  const activeText = useStore((s) => (s.view === 'editor' && s.activePath ? s.texts[s.activePath] ?? '' : ''))
  const goBack = useStore((s) => s.goBack)
  const goForward = useStore((s) => s.goForward)
  const histIndex = useStore((s) => s.histIndex)
  const histLen = useStore((s) => s.history.length)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const rightbarOpen = useStore((s) => s.rightbarOpen)
  const toggleRightbar = useStore((s) => s.toggleRightbar)
  const revealNote = useStore((s) => s.revealNote)
  const deleteNote = useStore((s) => s.deleteNote)
  const [pageMenu, setPageMenu] = useState<{ x: number; y: number } | null>(null)

  const nameOf = (p: string): string => files.find((f) => f.path === p)?.name ?? p.replace(/\.md$/i, '')
  const title = view === 'editor' ? (activePath ? nameOf(activePath) : 'No note') : VIEW_TITLE[view]
  const stats = view === 'editor' && activePath ? noteStats(activeText) : null

  return (
    <div className="tabstrip">
      <button
        className="nav-btn sidebar-toggle"
        onClick={() => toggleSidebar()}
        title={`${sidebarOpen ? 'Hide' : 'Show'} sidebar (⌘\\)`}
      >
        ☰
      </button>
      <div className="nav-btns">
        <button className="nav-btn" disabled={histIndex <= 0} onClick={() => goBack()} title="Back (⌘[)">
          ‹
        </button>
        <button
          className="nav-btn"
          disabled={histIndex >= histLen - 1}
          onClick={() => goForward()}
          title="Forward (⌘])"
        >
          ›
        </button>
      </div>
      <span className="topbar-title">{title}</span>
      {stats && (
        <span className="wc-stat" title="Word count · reading time">
          {stats.words.toLocaleString()} words · {stats.minutes} min
        </span>
      )}
      {view === 'editor' && activePath && (
        <button
          className="nav-btn page-menu-btn"
          title="Page actions"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setPageMenu({ x: r.right - 200, y: r.bottom + 4 })
          }}
        >
          ⋯
        </button>
      )}
      {view !== 'graph' && view !== 'canvas' && (
        <button
          className="nav-btn rightbar-toggle"
          onClick={() => toggleRightbar()}
          title={`${rightbarOpen ? 'Hide' : 'Show'} right panel (⌘⇧\\)`}
        >
          ☰
        </button>
      )}
      {pageMenu && activePath && (
        <ContextMenu
          x={pageMenu.x}
          y={pageMenu.y}
          items={[
            { label: REVEAL_LABEL, onClick: () => void revealNote(activePath) },
            {
              label: 'Delete',
              danger: true,
              onClick: () => {
                if (window.confirm(`Move “${nameOf(activePath)}” to the Trash?`)) void deleteNote(activePath)
              }
            }
          ]}
          onClose={() => setPageMenu(null)}
        />
      )}
    </div>
  )
}

// Remembers each note's scroll offset for the session, so switching away and back returns
// you to where you were rather than the top. In-memory only (deliberately not persisted).
const scrollMemory = new Map<string, number>()

function NoteArea({ path }: { path: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // BlockEditor (keyed by path) has just remounted with this note's content, so the
    // scroll height is in place — restore the saved offset.
    el.scrollTop = scrollMemory.get(path) ?? 0
    // The listener keeps this note's offset current while it's open; we must NOT save again
    // in cleanup, because by then the keyed BlockEditor has swapped in the next note's
    // content and el.scrollTop no longer belongs to `path`.
    const save = (): void => void scrollMemory.set(path, el.scrollTop)
    el.addEventListener('scroll', save, { passive: true })
    return () => el.removeEventListener('scroll', save)
  }, [path])
  return (
    <div className="scroll-area" ref={ref}>
      <div className="doc">
        <NoteTitle path={path} />
        <BlockEditor key={path} path={path} />
      </div>
      <Backlinks path={path} />
    </div>
  )
}

function SideNote({ path, paneIndex }: { path: string; paneIndex: number }): React.JSX.Element {
  const closeSidePane = useStore((s) => s.closeSidePane)
  const name = useStore((s) => s.files.find((f) => f.path === path)?.name ?? path.split('/').pop())
  return (
    <div className="side-note">
      <div className="pdf-pane-head">
        <span className="pdf-pane-title">{name}</span>
        <button className="icon-btn" title="Close pane" onClick={() => closeSidePane(paneIndex)}>
          ✕
        </button>
      </div>
      <NoteArea path={path} />
    </div>
  )
}

/** One right-hand split: a draggable divider plus its note/PDF content. */
function SplitPane({ pane, paneIndex }: { pane: SidePane; paneIndex: number }): React.JSX.Element {
  const [width, setWidth] = useState(480)

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const onMove = (ev: MouseEvent): void =>
      setWidth(Math.min(Math.max(280, startW + (startX - ev.clientX)), window.innerWidth - 360))
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <>
      <div className="pane-resize" onMouseDown={startResize} title="Drag to resize" />
      <ErrorBoundary>
        <Suspense fallback={<div className="view-loading">Loading…</div>}>
          <div className="split-pane" style={{ width }}>
            {pane.kind === 'pdf' ? (
              <PdfWorkspace key={pane.path} path={pane.path} width={width} paneIndex={paneIndex} />
            ) : (
              <SideNote key={pane.path} path={pane.path} paneIndex={paneIndex} />
            )}
          </div>
        </Suspense>
      </ErrorBoundary>
    </>
  )
}

function RightSidebar(): React.JSX.Element {
  const view = useStore((s) => s.view)
  const activePath = useStore((s) => s.activePath)
  const ensureDailyNote = useStore((s) => s.ensureDailyNote)
  const openNote = useStore((s) => s.openNote)

  return (
    <aside className="rightbar">
      <Calendar onPick={(iso) => void ensureDailyNote(iso).then(openNote)} />
      {view === 'editor' && activePath && (
        <>
          <div className="rightbar-title">Properties</div>
          <PropertiesPanel key={activePath} path={activePath} />
          <TableOfContents key={'toc:' + activePath} path={activePath} />
          <LocalGraph key={'lg:' + activePath} path={activePath} />
        </>
      )}
    </aside>
  )
}

function MainArea(): React.JSX.Element {
  const view = useStore((s) => s.view)
  const activePath = useStore((s) => s.activePath)
  const sidePanes = useStore((s) => s.sidePanes)
  const rightbarOpen = useStore((s) => s.rightbarOpen)

  let content: React.ReactNode
  if (view === 'graph') content = <GraphView />
  else if (view === 'canvas') content = <CanvasView />
  else if (view === 'database') content = <BasesView />
  else if (view === 'assets') content = <AssetsView />
  else if (view === 'tags') content = <TagsView />
  else if (view === 'journal') content = <JournalView />
  else if (view === 'todos') content = <TodosView />
  else if (activePath) content = <NoteArea path={activePath} />
  else
    content = (
      <div className="scroll-area">
        <div className="doc empty-doc">
          <img className="empty-logo" src="./logo-wordmark.png" alt="Verso" />
          <p className="empty-note">Select or create a note from the sidebar.</p>
        </div>
      </div>
    )

  return (
    <div className="main">
      <TopBar />
      <div className="main-body">
        <ErrorBoundary>
          <Suspense fallback={<div className="view-loading">Loading…</div>}>{content}</Suspense>
        </ErrorBoundary>
        {sidePanes.map((p, i) => (
          <SplitPane key={`${p.kind}:${p.path}`} pane={p} paneIndex={i} />
        ))}
        {sidePanes.length || view === 'graph' || view === 'canvas' || !rightbarOpen ? null : ( // graph/canvas full width; or panel hidden
          <ErrorBoundary>
            <Suspense fallback={null}>
              <RightSidebar />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
    </div>
  )
}

export function App(): React.JSX.Element {
  const workspace = useStore((s) => s.workspace)
  const bootstrap = useStore((s) => s.bootstrap)
  const applyFileEvent = useStore((s) => s.applyFileEvent)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const theme = useStore((s) => s.theme)
  const accent = useStore((s) => s.accent)
  const customCss = useStore((s) => s.customCss)
  const editorFont = useStore((s) => s.editorFont)
  const editorFontSize = useStore((s) => s.editorFontSize)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Accent theme: override the palette's accent variables on the root element.
  useEffect(() => {
    const a = ACCENTS.find((x) => x.key === accent) ?? ACCENTS[0]
    const root = document.documentElement
    root.style.setProperty('--accent', a.accent)
    root.style.setProperty('--accent-dim', a.accentDim)
    root.style.setProperty('--link', a.link)
  }, [accent])

  // Vault custom stylesheet (`.verso/custom.css`) — injected as a <style> tag and
  // hot-reloaded when the file changes on disk (via the watcher).
  useEffect(() => {
    let el = document.getElementById('vault-custom-css') as HTMLStyleElement | null
    if (!customCss) {
      el?.remove()
      return
    }
    if (!el) {
      el = document.createElement('style')
      el.id = 'vault-custom-css'
      document.head.appendChild(el)
    }
    el.textContent = customCss
  }, [customCss])

  useEffect(() => {
    const font = EDITOR_FONTS.find((f) => f.key === editorFont) ?? EDITOR_FONTS[0]
    const root = document.documentElement
    root.style.setProperty('--font-editor', font.stack)
    root.style.setProperty('--doc-font-size', `${editorFontSize}px`)
  }, [editorFont, editorFontSize])

  useEffect(() => {
    void bootstrap()
    const off = window.inkwell.onFileEvent((event) => void applyFileEvent(event))
    return off
  }, [bootstrap, applyFileEvent])

  // Flush any debounced writes when the window is hidden or closing, so edits and
  // checkbox toggles aren't lost if the app is quit before the save timer fires.
  useEffect(() => {
    const flush = (): void => void useStore.getState().saveActive()
    const onVis = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // Navigation shortcuts: command palette, back/forward, and close the last split.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      const s = useStore.getState()
      // While typing in a field, don't hijack keys that edit or navigate — a stray
      // ⌘[ in a rename input must not throw away the user's typing context.
      const typing = !!(e.target as HTMLElement | null)?.closest?.(
        'input, textarea, [contenteditable="true"]'
      )
      if (e.key === 'k' || e.key === 'K' || (e.key === 'p' && !e.shiftKey)) {
        e.preventDefault()
        s.setPalette(!s.paletteOpen)
      } else if (e.key === '[' && !typing) {
        e.preventDefault()
        s.goBack()
      } else if (e.key === ']' && !typing) {
        e.preventDefault()
        s.goForward()
      } else if (e.key === 'w' && !typing && s.sidePanes.length) {
        e.preventDefault()
        s.closeSidePane()
      } else if (e.code === 'Backslash' && e.shiftKey) {
        e.preventDefault()
        s.toggleRightbar()
      } else if (e.key === '\\') {
        e.preventDefault()
        s.toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!workspace) return <Welcome />

  return (
    <div className={'app' + (sidebarOpen ? '' : ' sidebar-closed')}>
      {sidebarOpen && <Sidebar />}
      <MainArea />
      <LinkPreview />
      <CommandPalette />
      <Modals />
      <SaveErrorToast />
    </div>
  )
}

/** A dismissible toast for failed disk writes — a save must never fail silently. */
function SaveErrorToast(): React.JSX.Element | null {
  const saveError = useStore((s) => s.saveError)
  const dismiss = useStore((s) => s.dismissSaveError)
  if (!saveError) return null
  return (
    <div className="save-toast" role="alert">
      <span>⚠︎ {saveError}</span>
      <button className="icon-btn" title="Dismiss" onClick={() => dismiss()}>
        ✕
      </button>
    </div>
  )
}

function Modals(): React.JSX.Element | null {
  const modal = useStore((s) => s.modal)
  const closeModal = useStore((s) => s.closeModal)
  if (modal === 'settings') return <Settings onClose={closeModal} />
  if (modal === 'help') return <Help onClose={closeModal} />
  return null
}
