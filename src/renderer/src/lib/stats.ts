import { stripFrontmatter } from './frontmatter'

/** Word count + reading time for a note (frontmatter and Markdown markers stripped). */
export function noteStats(text: string): { words: number; minutes: number } {
  const plain = stripFrontmatter(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, n, a) => a || n)
    .replace(/[#>*_~`|-]/g, ' ')
  const words = (plain.match(/\S+/g) || []).length
  const minutes = Math.max(1, Math.round(words / 200))
  return { words, minutes }
}
