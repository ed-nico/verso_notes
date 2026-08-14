import { useStore } from '../store'

/**
 * "The vault is still loading, so this screen is incomplete."
 *
 * Every vault-WIDE derivation — search, backlinks, the graph, queries, todos,
 * tags, Tend — is built from notes that stream in after the first paint. The
 * sidebar said so; nothing else did, so a half-built graph or a todo list missing
 * half its items just looked wrong. Each of those screens carries this instead.
 */
export function VaultLoadingNote({ what }: { what: string }): React.JSX.Element | null {
  const vaultLoading = useStore((s) => s.vaultLoading)
  const loaded = useStore((s) => s.loadedCount)
  const total = useStore((s) => s.totalCount)
  if (!vaultLoading) return null
  return (
    <div className="vault-loading-note" role="status">
      <span className="vault-loading-dot" />
      Still reading the vault — {loaded.toLocaleString()} of {total.toLocaleString()} notes. {what}
    </div>
  )
}
