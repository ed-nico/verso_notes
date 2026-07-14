import { useMemo, useRef, useState } from 'react'
import { useStore, templatesFromFiles } from '../store'
import { dirname } from '../lib/links'
import { searchNotes } from '../lib/search'
import { supertagsFromParsed } from '../lib/supertags'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { VaultSwitcher } from './VaultSwitcher'
import { NOTE_DND_MIME } from '../lib/canvas'
import { REVEAL_LABEL } from '../lib/platform'
import type { NoteFile } from '@shared/types'

interface MenuState {
  path: string
  name: string
  x: number
  y: number
}

type TreeFile = { type: 'file'; file: NoteFile }
type TreeFolder = { type: 'folder'; name: string; path: string; children: TreeNode[] }
type TreeNode = TreeFile | TreeFolder

function buildTree(files: NoteFile[], orderOf: (p: string) => number): TreeFolder {
  const root: TreeFolder = { type: 'folder', name: '', path: '', children: [] }
  const map = new Map<string, TreeFolder>([['', root]])
  const ensure = (path: string): TreeFolder => {
    const existing = map.get(path)
    if (existing) return existing
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const parent = ensure(parentPath)
    const node: TreeFolder = { type: 'folder', name: path.slice(path.lastIndexOf('/') + 1), path, children: [] }
    map.set(path, node)
    parent.children.push(node)
    return node
  }
  for (const f of files) ensure(dirname(f.path)).children.push({ type: 'file', file: f })

  const sort = (node: TreeFolder): void => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      if (a.type === 'folder' && b.type === 'folder') return a.name.localeCompare(b.name)
      const fa = (a as TreeFile).file
      const fb = (b as TreeFile).file
      return orderOf(fa.path) - orderOf(fb.path) || fa.name.localeCompare(fb.name)
    })
    node.children.forEach((c) => c.type === 'folder' && sort(c))
  }
  sort(root)
  return root
}

/** Total number of files anywhere under a folder (recurses all the way down). */
function countFiles(node: TreeFolder): number {
  let n = 0
  for (const c of node.children) n += c.type === 'file' ? 1 : countFiles(c)
  return n
}

// Zustand runs selectors on EVERY store set — including each keystroke — so the
// O(files) signature build is memoized on the input map identities. Typing never
// changes either identity (texts mutates in place; parsed swaps only on the
// debounced rebuild), so the common case is a two-pointer compare.
let sigMemo: { files: unknown; parsed: unknown; sig: string } | null = null
function structSigOf(
  files: { path: string }[],
  parsed: Record<string, { frontmatter: Record<string, unknown> }>
): string {
  if (sigMemo && sigMemo.files === files && sigMemo.parsed === parsed) return sigMemo.sig
  let sig = ''
  for (const f of files) {
    const fm = parsed[f.path]?.frontmatter as { _order?: unknown; pinned?: unknown } | undefined
    sig += f.path + ':' + String(fm?._order ?? '') + (fm?.pinned ? 'P' : '') + ';'
  }
  sigMemo = { files, parsed, sig }
  return sig
}

export function Sidebar(): React.JSX.Element {
  const files = useStore((s) => s.files)
  // A signature of just the sidebar-relevant structure (files + order + pins).
  // The sidebar re-renders only when this changes — NOT on every body keystroke,
  // which would otherwise rebuild the whole file tree as you type.
  const structSig = useStore((s) => structSigOf(s.files, s.parsed))
  const activePath = useStore((s) => s.activePath)
  const view = useStore((s) => s.view)
  const openNote = useStore((s) => s.openNote)
  const openNoteWithFind = useStore((s) => s.openNoteWithFind)
  const openInSidePane = useStore((s) => s.openInSidePane)
  const openView = useStore((s) => s.openView)
  const bases = useStore((s) => s.bases)
  const activeBaseId = useStore((s) => s.activeBaseId)
  const openBase = useStore((s) => s.openBase)
  const canvases = useStore((s) => s.canvases)
  const activeCanvasPath = useStore((s) => s.activeCanvasPath)
  const openCanvasView = useStore((s) => s.openCanvasView)
  const openCanvas = useStore((s) => s.openCanvas)
  const createCanvas = useStore((s) => s.createCanvas)
  const renameCanvas = useStore((s) => s.renameCanvas)
  const deleteCanvas = useStore((s) => s.deleteCanvas)
  const templates = useMemo(() => templatesFromFiles(files), [files])
  const newFromTemplate = useStore((s) => s.newFromTemplate)
  const openModal = useStore((s) => s.openModal)
  const setPalette = useStore((s) => s.setPalette)
  const navigate = useStore((s) => s.navigate)
  const renameNote = useStore((s) => s.renameNote)
  const deleteNote = useStore((s) => s.deleteNote)
  const duplicateNote = useStore((s) => s.duplicateNote)
  const revealNote = useStore((s) => s.revealNote)
  const reorderNote = useStore((s) => s.reorderNote)
  const reorderTo = useStore((s) => s.reorderTo)
  const moveToFolder = useStore((s) => s.moveToFolder)
  const togglePin = useStore((s) => s.togglePin)
  const applyTemplateToNote = useStore((s) => s.applyTemplateToNote)
  const applySupertagToFolder = useStore((s) => s.applySupertagToFolder)
  const createSupertagFromFolder = useStore((s) => s.createSupertagFromFolder)

  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [applyMenu, setApplyMenu] = useState<MenuState | null>(null)
  const [folderMenu, setFolderMenu] = useState<MenuState | null>(null)
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null)
  const [canvasMenu, setCanvasMenu] = useState<MenuState | null>(null)
  const [renamingCanvas, setRenamingCanvas] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  // Track which folders are expanded; default (empty) = all folders collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [newFolder, setNewFolder] = useState(false)
  const [basesOpen, setBasesOpen] = useState(false)
  const [canvasesOpen, setCanvasesOpen] = useState(false)
  const [dragPath, setDragPath] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<string | null>(null)

  const orderOf = (p: string): number => {
    const o = useStore.getState().parsed[p]?.frontmatter._order
    return typeof o === 'number' ? o : Number.MAX_SAFE_INTEGER
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tree = useMemo(() => buildTree(files, orderOf), [files, structSig])

  const results = useMemo(
    () =>
      query.trim()
        ? searchNotes(query, files, useStore.getState().texts, 60, {
            fuzzyNames: false,
            aliasOf: (p) => useStore.getState().parsed[p]?.aliases ?? [],
            parsed: useStore.getState().parsed
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, files, structSig]
  )

  const pinned = useMemo(() => {
    const parsed = useStore.getState().parsed
    return files
      .filter((f) => parsed[f.path]?.frontmatter.pinned === true)
      .sort((a, b) => a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, structSig])

  const uniqueUntitled = (folder: string): string => {
    const taken = new Set(files.map((f) => f.path.toLowerCase()))
    const prefix = folder ? `${folder}/` : ''
    let name = `${prefix}Untitled.md`
    let i = 1
    while (taken.has(name.toLowerCase())) name = `${prefix}Untitled ${i++}.md`
    return name.replace(/\.md$/i, '')
  }

  const commitRename = (path: string, value: string): void => {
    setRenaming(null)
    if (value.trim()) void renameNote(path, value)
  }
  const confirmDelete = (path: string, name: string): void => {
    if (window.confirm(`Move “${name}” to the Trash?`)) void deleteNote(path)
  }
  const toggleFolder = (path: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })

  const supertags = useMemo(
    () => supertagsFromParsed(useStore.getState().parsed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, structSig]
  )

  const folderMenuItems = (m: MenuState): MenuItem[] => [
    { label: '＋ New note here', onClick: () => void navigate(uniqueUntitled(m.path)) },
    ...supertags.map((s) => ({
      label: `▤ Tag all as ${s.name}`,
      onClick: () => void applySupertagToFolder(m.path, s.name)
    })),
    { label: '✦ Create supertag from folder', onClick: () => void createSupertagFromFolder(m.path) }
  ]

  const menuItems = (m: MenuState): MenuItem[] => {
    const isPinned = pinned.some((f) => f.path === m.path)
    return [
      { label: 'Rename', onClick: () => setRenaming(m.path) },
      { label: isPinned ? 'Unpin' : 'Pin to top', onClick: () => void togglePin(m.path) },
      ...(templates.length ? [{ label: '▤ Apply template…', onClick: () => setApplyMenu(m) }] : []),
      { label: 'Duplicate', onClick: () => void duplicateNote(m.path) },
      { label: REVEAL_LABEL, onClick: () => void revealNote(m.path) },
      { label: 'Delete', danger: true, onClick: () => confirmDelete(m.path, m.name) }
    ]
  }

  const FileRow = ({ file, depth }: { file: NoteFile; depth: number }): React.JSX.Element => {
    // Guards the rename input's Enter/Escape against the blur that follows them —
    // without it Enter would commit twice (the second attempt fails and toasts).
    const renameDone = useRef(false)
    if (renaming === file.path) {
      return (
        <input
          className="file-rename"
          autoFocus
          defaultValue={file.name}
          style={{ marginLeft: depth * 14 }}
          onFocus={(e) => {
            renameDone.current = false
            e.target.select()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              renameDone.current = true
              commitRename(file.path, e.currentTarget.value)
            } else if (e.key === 'Escape') {
              renameDone.current = true
              setRenaming(null)
            }
          }}
          // Clicking away COMMITS (matching the canvas rename) — typed input is
          // work; only an explicit Escape discards it.
          onBlur={(e) => {
            if (!renameDone.current) commitRename(file.path, e.currentTarget.value)
          }}
        />
      )
    }
    return (
      <div
        className={
          'file-item' +
          (file.path === activePath && view === 'editor' ? ' active' : '') +
          (dragPath === file.path ? ' dragging' : '') +
          (dropHint === file.path ? ' drop-target' : '')
        }
        style={{ paddingLeft: 10 + depth * 14 }}
        draggable
        onDragStart={(e) => {
          setDragPath(file.path)
          e.dataTransfer.effectAllowed = 'move'
          // Lets the file be dropped onto a canvas as a note card.
          e.dataTransfer.setData(NOTE_DND_MIME, file.path)
        }}
        onDragEnd={() => {
          setDragPath(null)
          setDropHint(null)
        }}
        onDragOver={(e) => {
          if (dragPath && dragPath !== file.path) {
            e.preventDefault()
            setDropHint(file.path)
          }
        }}
        onDragLeave={() => setDropHint((h) => (h === file.path ? null : h))}
        onDrop={(e) => {
          e.preventDefault()
          if (dragPath && dragPath !== file.path) void reorderTo(dragPath, file.path)
          setDragPath(null)
          setDropHint(null)
        }}
        onClick={(e) => (e.metaKey || e.ctrlKey ? openInSidePane(file.path) : openNote(file.path))}
        role="link"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.metaKey || e.ctrlKey) openInSidePane(file.path)
            else openNote(file.path)
          }
        }}
        onDoubleClick={() => setRenaming(file.path)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ path: file.path, name: file.name, x: e.clientX, y: e.clientY })
        }}
        title={file.path}
      >
        <span className="file-name">{file.name}</span>
        <span className="reorder">
          <button
            className="reorder-btn"
            title="Move up"
            onClick={(e) => {
              e.stopPropagation()
              void reorderNote(file.path, -1)
            }}
          >
            ▲
          </button>
          <button
            className="reorder-btn"
            title="Move down"
            onClick={(e) => {
              e.stopPropagation()
              void reorderNote(file.path, 1)
            }}
          >
            ▼
          </button>
        </span>
      </div>
    )
  }

  const renderNode = (node: TreeNode, depth: number): React.JSX.Element => {
    if (node.type === 'file') return <FileRow key={node.file.path} file={node.file} depth={depth} />
    const isCollapsed = !expanded.has(node.path)
    return (
      <div key={node.path}>
        <div
          className={'folder-item' + (dropHint === 'folder:' + node.path ? ' drop-target' : '')}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => toggleFolder(node.path)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggleFolder(node.path)
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            setFolderMenu({ path: node.path, name: node.name, x: e.clientX, y: e.clientY })
          }}
          onDragOver={(e) => {
            if (dragPath && dirname(dragPath) !== node.path) {
              e.preventDefault()
              setDropHint('folder:' + node.path)
            }
          }}
          onDragLeave={() => setDropHint((h) => (h === 'folder:' + node.path ? null : h))}
          onDrop={(e) => {
            e.preventDefault()
            if (dragPath && dirname(dragPath) !== node.path) void moveToFolder(dragPath, node.path)
            setDragPath(null)
            setDropHint(null)
          }}
          title="Click to collapse · right-click for folder actions · drop a note to move it in"
        >
          <span className="folder-caret">{isCollapsed ? '▸' : '▾'}</span>
          <span className="folder-name">{node.name}</span>
          <span className="folder-count">{countFiles(node)}</span>
        </div>
        {!isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className="sidebar">
      {/* Draggable strip clears the macOS traffic-lights; the vault switcher opts out of drag. */}
      <div className="sidebar-header">
        <VaultSwitcher />
      </div>
      <div className="search-wrap">
        <input
          className="search"
          placeholder="Search notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="search-cmd" title="Quick switcher (⌘K)" onClick={() => setPalette(true)}>
          ⌘K
        </button>
      </div>
      <div className="sidebar-actions">
        <button
          className="icon-btn new-note"
          title="New note (blank or from template)"
          onClick={(e) =>
            setNewMenu({
              x: e.currentTarget.getBoundingClientRect().left,
              y: e.currentTarget.getBoundingClientRect().bottom + 4
            })
          }
        >
          ＋ New note ▾
        </button>
        <button className="icon-btn" onClick={() => setNewFolder(true)} title="New folder">
          🗀 Folder
        </button>
      </div>
      <div className="sidebar-nav">
        <div className="nav-grid">
          <button className={'nav-item' + (view === 'journal' ? ' active' : '')} onClick={() => openView('journal')}>
            ☼ Journal
          </button>
          <button className={'nav-item' + (view === 'todos' ? ' active' : '')} onClick={() => openView('todos')}>
            ✓ Todos
          </button>
          <button className={'nav-item' + (view === 'graph' ? ' active' : '')} onClick={() => openView('graph')}>
            ⦿ Graph
          </button>
          <button className={'nav-item' + (view === 'tags' ? ' active' : '')} onClick={() => openView('tags')}>
            # Tags
          </button>
          <button
            className={'nav-item' + (view === 'database' ? ' active' : '')}
            onClick={() => {
              openView('database')
              if (bases.length) setBasesOpen((v) => !v)
            }}
          >
            {bases.length > 0 && <span className="nav-caret">{basesOpen ? '▾' : '▸'}</span>}▦ Bases
          </button>
          <button className={'nav-item' + (view === 'assets' ? ' active' : '')} onClick={() => openView('assets')}>
            ⧉ Assets
          </button>
          <button
            className={'nav-item' + (view === 'canvas' ? ' active' : '')}
            onClick={() => {
              openCanvasView()
              if (canvases.length) setCanvasesOpen((v) => !v)
            }}
          >
            {canvases.length > 0 && <span className="nav-caret">{canvasesOpen ? '▾' : '▸'}</span>}▱ Canvas
          </button>
        </div>
        {basesOpen &&
          bases.map((b) => (
            <button
              key={b.id}
              className={'nav-subitem' + (view === 'database' && activeBaseId === b.id ? ' active' : '')}
              onClick={() => openBase(b.id)}
            >
              {b.name}
            </button>
          ))}
        {canvasesOpen &&
          canvases.map((c) =>
            renamingCanvas === c.path ? (
              <input
                key={c.path}
                className="file-rename"
                autoFocus
                defaultValue={c.name}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = e.currentTarget.value
                    setRenamingCanvas(null)
                    if (v.trim()) void renameCanvas(c.path, v)
                  } else if (e.key === 'Escape') setRenamingCanvas(null)
                }}
                onBlur={(e) => {
                  const v = e.currentTarget.value
                  setRenamingCanvas(null)
                  if (v.trim() && v.trim() !== c.name) void renameCanvas(c.path, v)
                }}
              />
            ) : (
              <button
                key={c.path}
                className={'nav-subitem' + (view === 'canvas' && activeCanvasPath === c.path ? ' active' : '')}
                onClick={() => openCanvas(c.path)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setCanvasMenu({ path: c.path, name: c.name, x: e.clientX, y: e.clientY })
                }}
                title={c.path}
              >
                ▱ {c.name}
              </button>
            )
          )}
        {canvasesOpen && (
          <button className="nav-subitem nav-subitem-add" onClick={() => void createCanvas('Canvas')}>
            ＋ New canvas
          </button>
        )}
      </div>
      <div className="file-list">
        {newFolder && (
          <input
            className="file-rename"
            autoFocus
            placeholder="folder name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const name = e.currentTarget.value.trim()
                setNewFolder(false)
                if (name) void navigate(uniqueUntitled(name))
              } else if (e.key === 'Escape') setNewFolder(false)
            }}
            onBlur={() => setNewFolder(false)}
          />
        )}
        {!results && pinned.length > 0 && (
          <div className="pinned-section">
            <div className="pinned-head">Pinned</div>
            {pinned.map((f) => (
              <div
                key={f.path}
                className={'pinned-item' + (f.path === activePath && view === 'editor' ? ' active' : '')}
                onClick={(e) => (e.metaKey || e.ctrlKey ? openInSidePane(f.path) : openNote(f.path))}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (e.metaKey || e.ctrlKey) openInSidePane(f.path)
                    else openNote(f.path)
                  }
                }}
                title={f.path}
              >
                <span className="file-name">{f.name}</span>
                <button
                  className="pin-star"
                  title="Unpin"
                  onClick={(e) => {
                    e.stopPropagation()
                    void togglePin(f.path)
                  }}
                >
                  ★
                </button>
              </div>
            ))}
          </div>
        )}
        {results ? (
          results.length ? (
            results.map((hit) => (
              <div
                key={hit.path}
                className={'search-hit' + (hit.path === activePath && view === 'editor' ? ' active' : '')}
                onClick={(e) =>
                  e.metaKey || e.ctrlKey ? openInSidePane(hit.path) : openNoteWithFind(hit.path, query.trim())
                }
                role="link"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (e.metaKey || e.ctrlKey) openInSidePane(hit.path)
                    else openNoteWithFind(hit.path, query.trim())
                  }
                }}
                title={hit.path}
              >
                <div className="search-hit-name">{hit.name}</div>
                {hit.snippet && <div className="search-hit-snippet">{hit.snippet}</div>}
                {dirname(hit.path) && <div className="search-hit-path">{dirname(hit.path)}</div>}
              </div>
            ))
          ) : (
            <div className="file-item dir">No matches</div>
          )
        ) : (
          tree.children.map((c) => renderNode(c, 0))
        )}
        {files.length === 0 && <div className="file-item dir">No notes</div>}
      </div>

      <div className="sidebar-footer">
        <button className="footer-btn" onClick={() => openModal('help')} title="Help & shortcuts">
          ? Help
        </button>
        <button className="footer-btn" onClick={() => openModal('settings')} title="Settings">
          ⚙ Settings
        </button>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />
      )}
      {canvasMenu && (
        <ContextMenu
          x={canvasMenu.x}
          y={canvasMenu.y}
          items={[
            { label: 'Rename', onClick: () => setRenamingCanvas(canvasMenu.path) },
            {
              label: 'Delete',
              danger: true,
              onClick: () => {
                if (window.confirm(`Move “${canvasMenu.name}” to the Trash?`)) void deleteCanvas(canvasMenu.path)
              }
            }
          ]}
          onClose={() => setCanvasMenu(null)}
        />
      )}
      {folderMenu && (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          items={folderMenuItems(folderMenu)}
          onClose={() => setFolderMenu(null)}
        />
      )}
      {applyMenu && (
        <ContextMenu
          x={applyMenu.x}
          y={applyMenu.y}
          items={templates.map((t) => ({
            label: `▤ ${t.name}`,
            onClick: () => void applyTemplateToNote(applyMenu.path, t.path)
          }))}
          onClose={() => setApplyMenu(null)}
        />
      )}
      {newMenu && (
        <ContextMenu
          x={newMenu.x}
          y={newMenu.y}
          items={[
            { label: '＋ Blank note', onClick: () => void navigate(uniqueUntitled('')) },
            ...templates.map((t) => ({ label: `▤ ${t.name}`, onClick: () => void newFromTemplate(t.path) })),
            ...(templates.length === 0
              ? [{ label: 'No templates — add .md files to Templates/', onClick: () => {} }]
              : [])
          ]}
          onClose={() => setNewMenu(null)}
        />
      )}
    </div>
  )
}
