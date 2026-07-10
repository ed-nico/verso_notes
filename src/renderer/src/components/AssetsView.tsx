import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { assetUrl } from '../lib/assets'
import type { AssetFile } from '@shared/types'

type SortKey = 'name' | 'added' | 'size' | 'ext'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function AssetsView(): React.JSX.Element {
  const texts = useStore((s) => s.texts)
  const files = useStore((s) => s.files)
  const openNote = useStore((s) => s.openNote)
  const openPdf = useStore((s) => s.openPdf)
  const revealNote = useStore((s) => s.revealNote)

  const [assets, setAssets] = useState<AssetFile[]>([])
  const [sortKey, setSortKey] = useState<SortKey>('added')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  const refresh = (): void => void window.inkwell.listAssets().then(setAssets)
  useEffect(refresh, [])

  const nameOf = (p: string): string => files.find((f) => f.path === p)?.name ?? p.replace(/\.md$/i, '')

  // Which notes reference each asset (by relative path or filename).
  const refsByAsset = useMemo(() => {
    const map = new Map<string, string[]>()
    const entries = Object.entries(texts)
    for (const a of assets) {
      const hits: string[] = []
      for (const [p, t] of entries) if (t.includes(a.path) || t.includes(a.name)) hits.push(p)
      map.set(a.path, hits)
    }
    return map
  }, [assets, texts])

  const sorted = useMemo(() => {
    const copy = [...assets]
    copy.sort((a, b) => {
      let cmp: number
      if (sortKey === 'size' || sortKey === 'added') cmp = a[sortKey] - b[sortKey]
      else cmp = String(a[sortKey]).localeCompare(String(b[sortKey]))
      return dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [assets, sortKey, dir])

  const toggleSort = (k: SortKey): void => {
    if (k === sortKey) setDir(dir === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(k)
      setDir(k === 'name' || k === 'ext' ? 'asc' : 'desc')
    }
  }

  const openAsset = (a: AssetFile): void => {
    if (a.ext === 'pdf') openPdf(a.path)
    else void revealNote(a.path)
  }

  // Trash an unused asset (recoverable) and drop it from the list.
  const removeAsset = async (a: AssetFile): Promise<void> => {
    if (!window.confirm(`Move “${a.name}” to the Trash?\n\nIt isn’t referenced by any note.`)) return
    if (await window.inkwell.deleteAsset(a.path)) setAssets((prev) => prev.filter((x) => x.path !== a.path))
  }

  const caret = (k: SortKey): string => (sortKey === k ? (dir === 'asc' ? ' ▲' : ' ▼') : '')

  return (
    <div className="scroll-area">
      <div className="assets">
        <div className="assets-head">
          <h2>Assets</h2>
          <span className="assets-count">{assets.length} files</span>
          <button className="btn-sm" onClick={refresh}>
            Refresh
          </button>
        </div>

        {assets.length === 0 ? (
          <p className="empty-note">
            No assets yet. Paste or drop images into a note, or open a PDF — they’ll be saved under
            <code> assets/</code> and listed here.
          </p>
        ) : (
          <table className="assets-table">
            <thead>
              <tr>
                <th></th>
                <th onClick={() => toggleSort('name')}>Name{caret('name')}</th>
                <th onClick={() => toggleSort('ext')}>Type{caret('ext')}</th>
                <th onClick={() => toggleSort('size')}>Size{caret('size')}</th>
                <th onClick={() => toggleSort('added')}>Added{caret('added')}</th>
                <th>Used in</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => {
                const refs = refsByAsset.get(a.path) ?? []
                return (
                  <tr key={a.path}>
                    <td className="asset-thumb-cell">
                      {IMAGE_EXTS.has(a.ext) ? (
                        <img className="asset-thumb" src={assetUrl(a.path)} alt="" loading="lazy" />
                      ) : (
                        <span className="asset-ext-badge">{a.ext}</span>
                      )}
                    </td>
                    <td className="asset-name title" onClick={() => openAsset(a)} title={a.path}>
                      {a.name}
                    </td>
                    <td className="asset-dim">{a.ext}</td>
                    <td className="asset-dim">{fmtSize(a.size)}</td>
                    <td className="asset-dim">{fmtDate(a.added)}</td>
                    <td>
                      {refs.length === 0 ? (
                        <span className="asset-orphan-wrap">
                          <span className="asset-orphan">unused</span>
                          <button
                            className="asset-del"
                            title="Move this unused file to the Trash"
                            onClick={() => void removeAsset(a)}
                          >
                            Delete
                          </button>
                        </span>
                      ) : (
                        refs.map((p) => (
                          <span className="asset-ref" key={p} onClick={() => openNote(p)}>
                            {nameOf(p)}
                          </span>
                        ))
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
