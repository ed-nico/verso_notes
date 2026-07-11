import React, { Fragment } from 'react'
import { isList, type Block } from '../lib/blocks'

/** One case-insensitive find-&-replace hit within a block. */
export type FindMatch = { id: number; index: number; start: number; end: number }

/** A suggestion row in the `[[` / `/` popup (see BlockEditor's AcState). */
export interface AcSuggestion {
  /** React key + identity: a file path, template path, or command id. */
  key: string
  label: string
  icon: string
  /** Containing folder (links only), shown to disambiguate. */
  sub?: string
  /** Link: a short excerpt of the target note, shown as the trailing breadcrumb. */
  excerpt?: string
  /** Link: text inserted inside `[[ ]]` — bare name, or full path when ambiguous. */
  insert?: string
  /** Tag: the tag name to complete after `#` (supertags listed first, badged). */
  tag?: string
  /** Tag picker: complete `#name` AND create a new supertag definition for it. */
  createTag?: string
  /** Template: the template file's path to read and insert. */
  tplPath?: string
  /** Slash menu: the command id to run. */
  cmd?: string
}

/**
 * The editor callbacks a row needs, passed through a ref so the memoized row keeps a
 * stable prop while always invoking the latest closures at event/render time.
 */
export interface RowApi {
  onRowMouseDown: (b: Block, e: React.MouseEvent) => void
  /** Drag-reorder from the bullet/number/checkbox handle (click still zooms/toggles). */
  onHandleMouseDown: (b: Block, e: React.MouseEvent) => void
  toggleCollapse: (id: number) => void
  toggleTask: (id: number) => void
  /** Zoom into a list item (bullet/number click) and start editing it. */
  zoomInto: (id: number) => void
  applyItem: (id: number, item: AcSuggestion) => void
  renderRich: (b: Block, tableWidths?: number[]) => React.ReactNode
  renderHighlighted: (b: Block, m: FindMatch) => React.ReactNode
  /** The editing surface: TableEditor for tables, the autosizing textarea otherwise. */
  renderEditing: (b: Block, index: number) => React.JSX.Element
  /** Popup kind for the ac list ('link' rows render breadcrumbs). */
  acKind: () => 'link' | 'tag' | 'slash-menu' | 'slash-template' | null
}

interface BlockRowProps {
  b: Block
  index: number
  depth: number
  foldable: boolean
  selected: boolean
  isEditing: boolean
  /** Hierarchical label for ordered items ("2", "1.3"), null for everything else. */
  orderedLbl: string | null
  tableWidths?: number[]
  /** The autocomplete popup's items when it belongs to this row, else null. */
  acList: AcSuggestion[] | null
  acIndex: number
  /** The active find match when it sits in this row, else null. */
  activeMatch: FindMatch | null
  /** Bumped when vault-wide data (parsed/files/index/spellcheck) changes, so cached
   *  rows refresh link resolution, entity chips, and squiggles. */
  dataTick: number
  api: React.RefObject<RowApi>
}

function shallowBlockEq(a: Block, b: Block): boolean {
  if (a === b) return true
  const ka = Object.keys(a) as (keyof Block)[]
  const kb = Object.keys(b) as (keyof Block)[]
  if (ka.length !== kb.length) return false
  for (const k of ka) if (a[k] !== b[k]) return false
  return true
}

const arrEq = (a?: number[], b?: number[]): boolean =>
  a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]))

const matchEq = (a: FindMatch | null, b: FindMatch | null): boolean =>
  a === b || (!!a && !!b && a.id === b.id && a.start === b.start && a.end === b.end)

function propsEq(p: BlockRowProps, n: BlockRowProps): boolean {
  return (
    shallowBlockEq(p.b, n.b) &&
    p.index === n.index &&
    p.depth === n.depth &&
    p.foldable === n.foldable &&
    p.selected === n.selected &&
    p.isEditing === n.isEditing &&
    p.orderedLbl === n.orderedLbl &&
    arrEq(p.tableWidths, n.tableWidths) &&
    p.acList === n.acList &&
    p.acIndex === n.acIndex &&
    matchEq(p.activeMatch, n.activeMatch) &&
    p.dataTick === n.dataTick
  )
}

/**
 * One outliner row, memoized so a keystroke re-renders only the edited block instead of
 * re-tokenizing every visible block's inline markdown (the editor's main render cost).
 */
export const BlockRow = React.memo(function BlockRow({
  b,
  index,
  depth,
  foldable,
  selected,
  isEditing,
  orderedLbl,
  tableWidths,
  acList,
  acIndex,
  activeMatch,
  api
}: BlockRowProps): React.JSX.Element {
  const h = api.current!
  const headingClass = b.type === 'heading' ? ` tok-heading tok-h${Math.min(b.level || 1, 6)}` : ''
  return (
    <div>
      <div
        className={
          'bl-row bl-' +
          b.type +
          (b.type === 'heading' ? ' is-heading' : '') +
          (selected ? ' selected' : '')
        }
        data-block-id={b.id}
        style={{ paddingLeft: depth * 24 }}
      >
        <span
          className="ol-fold"
          role={foldable ? 'button' : undefined}
          aria-label={foldable ? (b.collapsed ? 'Expand' : 'Collapse') : undefined}
          onClick={() => foldable && h.toggleCollapse(b.id)}
          style={{ visibility: foldable ? 'visible' : 'hidden' }}
        >
          {b.collapsed ? '▸' : '▾'}
        </span>
        {b.type === 'task' ? (
          <input
            type="checkbox"
            className="ol-checkbox"
            aria-label={b.text.trim().slice(0, 60) || 'task'}
            checked={!!b.checked}
            onMouseDown={(e) => {
              e.stopPropagation()
              h.onHandleMouseDown(b, e)
            }}
            onChange={() => h.toggleTask(b.id)}
          />
        ) : (
          isList(b) &&
          (b.ordered ? (
            <span
              className={'ol-number' + (b.collapsed && foldable ? ' has-hidden' : '')}
              onMouseDown={(e) => h.onHandleMouseDown(b, e)}
              onClick={() => h.zoomInto(b.id)}
              title="Zoom in · drag to move"
            >
              {/* top-level keeps the familiar "1."; nested levels read cleaner as
                  "1.1" / "1.1.1" without a trailing dot. */}
              {orderedLbl ? (orderedLbl.includes('.') ? orderedLbl : orderedLbl + '.') : ''}
            </span>
          ) : (
            <span
              className={'ol-bullet' + (b.collapsed && foldable ? ' has-hidden' : '')}
              onMouseDown={(e) => h.onHandleMouseDown(b, e)}
              onClick={() => h.zoomInto(b.id)}
              title="Zoom in · drag to move"
            />
          ))
        )}
        <div className={'ol-content' + headingClass}>
          {isEditing ? (
            h.renderEditing(b, index)
          ) : (
            <div className="ol-rendered" onMouseDown={(e) => h.onRowMouseDown(b, e)}>
              {activeMatch && b.type !== 'code' && b.type !== 'table'
                ? h.renderHighlighted(b, activeMatch)
                : h.renderRich(b, tableWidths)}
            </div>
          )}
          {acList && acList.length > 0 && (
            <div className="ol-ac">
              {acList.map((it, i) => {
                const sel = i === acIndex
                const onPick = (e: React.MouseEvent): void => {
                  e.preventDefault()
                  h.applyItem(b.id, it)
                }
                if (h.acKind() === 'link') {
                  // Breadcrumb: folder segments (or "→ alias") then a short excerpt.
                  const crumbs: string[] = []
                  if (it.sub) {
                    if (it.sub.startsWith('→')) crumbs.push(it.sub)
                    else crumbs.push(...it.sub.split('/').filter((s) => s && s !== '.'))
                  }
                  if (it.excerpt) crumbs.push(it.excerpt)
                  return (
                    <div
                      key={it.key}
                      className={'ol-ac-item link' + (sel ? ' sel' : '')}
                      onMouseDown={onPick}
                    >
                      <span className="ol-ac-title">{it.label}</span>
                      {crumbs.length > 0 && (
                        <span className="ol-ac-crumbs">
                          {crumbs.map((c, j) => (
                            <Fragment key={j}>
                              {j > 0 && <span className="ol-ac-sep">›</span>}
                              {c}
                            </Fragment>
                          ))}
                        </span>
                      )}
                    </div>
                  )
                }
                return (
                  <div key={it.key} className={'ol-ac-item' + (sel ? ' sel' : '')} onMouseDown={onPick}>
                    <span className="ol-ac-icon">{it.icon}</span>
                    <span className="ol-ac-label">{it.label}</span>
                    {it.sub && <span className="ol-ac-crumbs">{it.sub}</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}, propsEq)
