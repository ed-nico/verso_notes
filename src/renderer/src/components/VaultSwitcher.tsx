import { useState } from 'react'
import { useStore } from '../store'

/** Last path segment of a vault root, e.g. "/Users/x/Notes" → "Notes". */
function vaultName(root: string): string {
  const parts = root.split('/').filter(Boolean)
  return parts[parts.length - 1] || root
}

/**
 * Sidebar-header vault picker: shows the current vault and, on click, lets you swap to
 * any previously-opened vault, open a new folder, or forget one from the list. Lives in
 * the (draggable) header strip, so the controls opt out of the window-drag region.
 */
export function VaultSwitcher(): React.JSX.Element | null {
  const workspace = useStore((s) => s.workspace)
  const recents = useStore((s) => s.recentVaults)
  const switchVault = useStore((s) => s.switchVault)
  const openWorkspace = useStore((s) => s.openWorkspace)
  const forgetVault = useStore((s) => s.forgetVault)
  const [open, setOpen] = useState(false)

  if (!workspace) return null
  const current = workspace.root
  // Always show the active vault, even if the remembered list hasn't caught up yet.
  const list = recents.includes(current) ? recents : [current, ...recents]

  return (
    <div className="vault-switcher">
      <button className="vault-current" onClick={() => setOpen((v) => !v)} title={current}>
        <span className="vault-name">{vaultName(current)}</span>
        <span className="vault-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <>
          <div className="vault-backdrop" onClick={() => setOpen(false)} />
          <div className="vault-menu">
            {list.map((root) => (
              <div key={root} className={'vault-item' + (root === current ? ' active' : '')}>
                <span
                  className="vault-item-name"
                  title={root}
                  onClick={() => {
                    setOpen(false)
                    void switchVault(root)
                  }}
                >
                  {root === current ? '✓ ' : '  '}
                  {vaultName(root)}
                </span>
                {root !== current && (
                  <button
                    className="vault-forget"
                    title="Remove from this list (your files stay on disk)"
                    onClick={(e) => {
                      e.stopPropagation()
                      void forgetVault(root)
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <div className="vault-sep" />
            <div
              className="vault-item vault-add"
              onClick={() => {
                setOpen(false)
                void openWorkspace()
              }}
            >
              ＋ Open another folder…
            </div>
          </div>
        </>
      )}
    </div>
  )
}
