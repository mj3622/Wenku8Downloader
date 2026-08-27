import type { TitleFormat } from './config-types'

export function formatBookTitle(title: string, format: TitleFormat): string {
  if (format === 'FULL') return title

  const match = title.match(/^(.*?)\((.*?)\)$/)
  if (!match) return title

  return format === 'OUT' ? match[1].trim() : match[2].trim()
}
