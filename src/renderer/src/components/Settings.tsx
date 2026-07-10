import { useEffect } from 'react'
import { useStore, EDITOR_FONTS, EDITOR_SIZES, ACCENTS } from '../store'

export function Settings({ onClose }: { onClose: () => void }): React.JSX.Element {
  const workspace = useStore((s) => s.workspace)
  const openWorkspace = useStore((s) => s.openWorkspace)
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const accent = useStore((s) => s.accent)
  const setAccent = useStore((s) => s.setAccent)
  const customCss = useStore((s) => s.customCss)
  const editorFont = useStore((s) => s.editorFont)
  const setEditorFont = useStore((s) => s.setEditorFont)
  const editorFontSize = useStore((s) => s.editorFontSize)
  const setEditorFontSize = useStore((s) => s.setEditorFontSize)
  const smartLinkTitles = useStore((s) => s.smartLinkTitles)
  const setSmartLinkTitles = useStore((s) => s.setSmartLinkTitles)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setTheme = (t: 'light' | 'dark'): void => {
    if (theme !== t) toggleTheme()
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Settings</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-label">Vault</div>
          <div className="settings-path">{workspace?.root ?? 'No folder open'}</div>
          <button className="btn" onClick={() => void openWorkspace().then(onClose)}>
            Open a folder…
          </button>
          <div className="settings-hint">
            Pick any folder of Markdown notes. Verso reads and writes plain <code>.md</code> files —
            nothing leaves your disk.
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Appearance</div>
          <div className="seg">
            <button className={'seg-btn' + (theme === 'dark' ? ' active' : '')} onClick={() => setTheme('dark')}>
              ☾ Dark
            </button>
            <button className={'seg-btn' + (theme === 'light' ? ' active' : '')} onClick={() => setTheme('light')}>
              ☀ Light
            </button>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Accent</div>
          <div className="accent-row">
            {ACCENTS.map((a) => (
              <button
                key={a.key}
                className={'accent-swatch' + (accent === a.key ? ' active' : '')}
                style={{ background: a.accent }}
                title={a.label}
                aria-label={`Accent: ${a.label}`}
                onClick={() => setAccent(a.key)}
              />
            ))}
          </div>
          <div className="settings-hint">
            Colours links, buttons, and selection. For deeper theming, put CSS in{' '}
            <code>.verso/custom.css</code> inside your vault — it loads on start and hot-reloads on
            save{customCss !== null ? ' (currently active)' : ''}.
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Editor font</div>
          <div className="seg">
            {EDITOR_FONTS.map((f) => (
              <button
                key={f.key}
                className={'seg-btn' + (editorFont === f.key ? ' active' : '')}
                style={{ fontFamily: f.stack }}
                onClick={() => setEditorFont(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Font size</div>
          <div className="seg">
            {EDITOR_SIZES.map((s) => (
              <button
                key={s}
                className={'seg-btn' + (editorFontSize === s ? ' active' : '')}
                onClick={() => setEditorFontSize(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="settings-hint">Sets the size and typeface of the writing area. Code stays monospace.</div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Smart link titles</div>
          <div className="seg">
            <button
              className={'seg-btn' + (smartLinkTitles ? ' active' : '')}
              onClick={() => setSmartLinkTitles(true)}
            >
              On
            </button>
            <button
              className={'seg-btn' + (!smartLinkTitles ? ' active' : '')}
              onClick={() => setSmartLinkTitles(false)}
            >
              Off
            </button>
          </div>
          <div className="settings-hint">
            When you paste a bare URL, Verso fetches that page once to turn it into a titled
            link. This is the only feature that makes a network request by itself — turn it
            off and pasted URLs stay as-is.
          </div>
        </div>
      </div>
    </div>
  )
}
