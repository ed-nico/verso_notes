/**
 * PDF highlight model + persistence. Geometry lives in a JSON sidecar next to the
 * PDF (`<pdf>.hl.json`), mirroring Logseq's `.edn` sidecar. Coordinates are stored
 * as fractions of the page size so they survive zoom/resize.
 */

export interface HlRect {
  /** All fractions (0–1) of the page width/height. */
  left: number
  top: number
  width: number
  height: number
}

export interface Highlight {
  id: string
  page: number // 1-based
  color: string // hex
  text: string
  rects: HlRect[]
  /** 'text' (default) draws a filled marker; 'area' draws an outlined box (a captured region). */
  kind?: 'text' | 'area'
  createdAt: number
}

export const HL_COLORS = ['#f7d44c', '#7ee081', '#6cb6ff', '#ff8fa3', '#c79bff']

function sidecarPath(pdfPath: string): string {
  return pdfPath + '.hl.json'
}

export async function loadHighlights(pdfPath: string): Promise<Highlight[]> {
  const c = await window.inkwell.readNote(sidecarPath(pdfPath))
  if (!c) return []
  try {
    const parsed = JSON.parse(c.text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function saveHighlights(pdfPath: string, list: Highlight[]): Promise<void> {
  await window.inkwell.writeNote(sidecarPath(pdfPath), JSON.stringify(list, null, 2))
}
