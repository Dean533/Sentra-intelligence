// Some feed titles arrive HTML-escaped ("S&amp;P 500"). Decode the common entities for display.
export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}
