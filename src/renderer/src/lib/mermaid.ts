/**
 * Mermaid diagram rendering, kept behind ONE function (`renderMermaid`) so the
 * engine underneath can be swapped without touching any component.
 *
 * The `mermaid` bundle is large (comparable to highlight.js), so it is imported
 * lazily on first use — a note with no ```mermaid fence never pays for it.
 */

/** The palette handed to mermaid, read from the app's live CSS variables. */
interface Palette {
  bg: string
  bgElevated: string
  bgHover: string
  bgPanel: string
  border: string
  text: string
  textDim: string
  accent: string
  accentDim: string
  fontUi: string
  fontMono: string
}

type Mermaid = (typeof import('mermaid'))['default']

let loading: Promise<Mermaid> | null = null

function load(): Promise<Mermaid> {
  loading ??= import('mermaid').then((m) => m.default)
  return loading
}

/** Read one CSS custom property off the document root, with a fallback. */
function cssVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback
}

/** Snapshot the app's current theme variables. */
function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement)
  return {
    bg: cssVar(s, '--bg', '#151519'),
    bgElevated: cssVar(s, '--bg-elevated', '#202026'),
    bgHover: cssVar(s, '--bg-hover', '#26262e'),
    bgPanel: cssVar(s, '--bg-panel', '#1a1a1f'),
    border: cssVar(s, '--border', '#2b2b33'),
    text: cssVar(s, '--text', '#e2e2e8'),
    textDim: cssVar(s, '--text-dim', '#a6a6b2'),
    accent: cssVar(s, '--accent', '#7c8cff'),
    accentDim: cssVar(s, '--accent-dim', '#4a4f7a'),
    fontUi: cssVar(s, '--font-ui', 'sans-serif'),
    fontMono: cssVar(s, '--font-mono', 'monospace')
  }
}

/**
 * Map the app palette onto mermaid's `base` theme. Mermaid derives most of a
 * diagram's colours from a handful of seeds, so setting the seeds (plus the few
 * that don't derive cleanly) is enough to make every diagram type track the
 * app's theme and accent.
 */
function themeVariables(p: Palette, dark: boolean): Record<string, string> {
  return {
    darkMode: String(dark),
    background: p.bg,
    fontFamily: p.fontUi,
    fontSize: '14px',
    // Seeds: node fill / stroke / label colour.
    primaryColor: p.bgElevated,
    primaryTextColor: p.text,
    primaryBorderColor: p.accent,
    secondaryColor: p.bgHover,
    secondaryTextColor: p.text,
    secondaryBorderColor: p.border,
    tertiaryColor: p.bgPanel,
    tertiaryTextColor: p.text,
    tertiaryBorderColor: p.border,
    // Edges and free-standing text.
    lineColor: p.textDim,
    textColor: p.text,
    mainBkg: p.bgElevated,
    nodeBorder: p.accent,
    nodeTextColor: p.text,
    titleColor: p.text,
    edgeLabelBackground: p.bgPanel,
    clusterBkg: p.bgPanel,
    clusterBorder: p.border,
    noteBkgColor: p.accentDim,
    noteTextColor: p.text,
    noteBorderColor: p.accent,
    // Sequence/state/gantt bits that don't derive from the seeds above.
    actorBkg: p.bgElevated,
    actorBorder: p.accent,
    actorTextColor: p.text,
    actorLineColor: p.textDim,
    signalColor: p.text,
    signalTextColor: p.text,
    labelBoxBkgColor: p.bgElevated,
    labelBoxBorderColor: p.border,
    labelTextColor: p.text,
    loopTextColor: p.text,
    activationBkgColor: p.accentDim,
    activationBorderColor: p.accent,
    sectionBkgColor: p.bgPanel,
    altSectionBkgColor: p.bg,
    sectionBkgColor2: p.bgHover,
    taskBkgColor: p.bgElevated,
    taskBorderColor: p.accent,
    taskTextColor: p.text,
    taskTextOutsideColor: p.text,
    taskTextDarkColor: p.text,
    gridColor: p.border,
    doneTaskBkgColor: p.bgHover,
    doneTaskBorderColor: p.border,
    critBorderColor: p.accent,
    critBkgColor: p.accentDim,
    todayLineColor: p.accent,
    pie1: p.accent,
    pie2: p.accentDim,
    pie3: p.textDim,
    pieTitleTextColor: p.text,
    pieSectionTextColor: p.text,
    pieLegendTextColor: p.text,
    pieStrokeColor: p.border,
    pieOuterStrokeColor: p.border
  }
}

/** Ids must be unique per render — mermaid scopes the SVG's own <style> by id. */
let seq = 0

/**
 * Render mermaid source to an SVG string, themed from the app's palette.
 *
 * Rejects with the diagram's syntax error when the source doesn't parse; the
 * caller decides how to show it (mermaid's own error graphic is suppressed).
 */
export async function renderMermaid(code: string, opts: { dark: boolean }): Promise<string> {
  const mermaid = await load()
  // Read the palette only after the lazy import has resolved: on a theme/accent
  // switch this effect runs BEFORE App.tsx's effect writes the new CSS variables,
  // and the microtask hop above puts us safely after it.
  const palette = readPalette()
  mermaid.initialize({
    startOnLoad: false,
    // 'strict' sanitizes labels and blocks click-handler directives in note content.
    securityLevel: 'strict',
    // We render the failure ourselves — no stray error graphic in the note.
    suppressErrorRendering: true,
    theme: 'base',
    darkMode: opts.dark,
    fontFamily: palette.fontUi,
    themeVariables: themeVariables(palette, opts.dark)
  })
  const { svg } = await mermaid.render(`verso-mermaid-${++seq}`, code)
  return svg
}
