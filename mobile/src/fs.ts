/**
 * VaultFS — the mobile app's only filesystem surface. On a device it reads a
 * folder on shared storage (kept in sync by Syncthing/FolderSync/Nextcloud);
 * in the browser (dev/e2e) an in-memory sample vault stands in.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { Filesystem, Encoding } from '@capacitor/filesystem'
import type { NoteFile } from '@shared/types'

/** Native folder picker (see FolderPickerPlugin.java); rejects on cancel. */
export const FolderPicker = registerPlugin<{ pick(): Promise<{ path: string }> }>('FolderPicker')

/** Turn what people type/paste into a real path: the Files app displays
 *  "/Internal storage/…" for what is actually /storage/emulated/0/…. */
export function normalizeRoot(input: string): string {
  let p = input.trim().replace(/\/+$/, '')
  p = p.replace(/^\/?internal storage\//i, '/storage/emulated/0/')
  p = p.replace(/^\/sdcard(\/|$)/i, '/storage/emulated/0$1')
  return p
}

export interface VaultFS {
  /** All .md files under the vault root, recursively. */
  list(): Promise<NoteFile[]>
  read(path: string): Promise<string>
  write(path: string, text: string): Promise<void>
}

/** Folders never worth scanning on the phone. */
const IGNORED = new Set(['.git', '.obsidian', '.verso', '.trash', '.stfolder', '.stversions', 'node_modules'])

class DeviceFS implements VaultFS {
  constructor(private root: string) {}

  private abs(rel: string): string {
    return `${this.root}/${rel}`
  }

  async list(): Promise<NoteFile[]> {
    const out: NoteFile[] = []
    const walk = async (rel: string): Promise<void> => {
      const dir = rel ? this.abs(rel) : this.root
      const { files } = await Filesystem.readdir({ path: dir })
      for (const f of files) {
        if (f.name.startsWith('.') || IGNORED.has(f.name)) continue
        const childRel = rel ? `${rel}/${f.name}` : f.name
        if (f.type === 'directory') await walk(childRel)
        else if (f.name.toLowerCase().endsWith('.md')) {
          out.push({ path: childRel, name: f.name.replace(/\.md$/i, ''), mtime: f.mtime ?? 0 })
        }
      }
    }
    await walk('')
    return out.sort((a, b) => b.mtime - a.mtime)
  }

  async read(path: string): Promise<string> {
    const r = await Filesystem.readFile({ path: this.abs(path), encoding: Encoding.UTF8 })
    return typeof r.data === 'string' ? r.data : ''
  }

  async write(path: string, text: string): Promise<void> {
    await Filesystem.writeFile({
      path: this.abs(path),
      data: text,
      encoding: Encoding.UTF8,
      recursive: true
    })
  }
}

/** Browser dev/e2e stand-in: a small interlinked vault in memory. */
class ShimFS implements VaultFS {
  private notes = new Map<string, string>([
    ['Welcome.md', '- Welcome to **Verso mobile**\n- Open [[Reading List]] or the [[Projects/Alpha]] project\n- tags work: #mobile #demo\n\n![[Reading List]]\n'],
    ['Reading List.md', '- [ ] Dune\n- [x] The Dispossessed\n- see [[Projects/Alpha]]\n'],
    ['Projects/Alpha.md', '---\nstatus: active\npriority: 1\n---\n# Alpha\n\n- links back to [[Welcome]]\n- `inline code` and *italics* and [a url](https://example.com)\n- [ ] ship the beta\n'],
    ['Projects/Beta.md', '---\nstatus: done\npriority: 2\n---\n- finished project\n'],
    ['Books/Dune.md', '---\nstatus: active\nrating: 5\n---\n- a classic\n'],
    ['Table Demo.md', '# Demo\n\n| Col A | Col B |\n| --- | --- |\n| one | **bold** |\n| two | [[Welcome]] |\n'],
    ['Daily/2026/07/2026-07-11.md', '- an existing journal entry\n'],
    ['Daily/2026/07/2026-07-10.md', '- older day one\n'],
    ['Daily/2026/07/2026-07-09.md', '- older day two\n- [ ] journal task\n'],
    ['.verso/bases.json', JSON.stringify([{ id: 'b1', name: 'Active things', folder: '', tag: '', filters: [{ key: 'status', op: 'is', value: 'active' }], columns: ['name', 'status', 'priority'], groupKey: '', aggregates: {}, sortKey: 'name', sortDir: 'asc', layout: 'table' }])]
  ])

  async list(): Promise<NoteFile[]> {
    return [...this.notes.keys()]
      .filter((p) => p.toLowerCase().endsWith('.md') && !p.startsWith('.verso/'))
      .map((path, i) => ({
        path,
        name: path.replace(/\.md$/i, '').split('/').pop()!,
        mtime: 1000 - i
      }))
  }

  async read(path: string): Promise<string> {
    return this.notes.get(path) ?? ''
  }

  async write(path: string, text: string): Promise<void> {
    this.notes.set(path, text)
  }
}

export function makeVaultFS(root: string): VaultFS {
  return Capacitor.isNativePlatform() ? new DeviceFS(root) : new ShimFS()
}

export const isNative = (): boolean => Capacitor.isNativePlatform()
