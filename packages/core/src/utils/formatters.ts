export function fmt(value: number | null, suffix = ''): string {
  if (value === null || value === undefined) return '--'
  return `${Number(value).toFixed(2)}${suffix}`
}

export function fmtPct(value: number | null): string {
  if (value === null || value === undefined) return '--'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${Number(value).toFixed(2)}%`
}

export function fmtChange(value: number | null): string {
  if (value === null || value === undefined) return '--'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${Number(value).toFixed(2)}`
}

export function fmtTrillions(value: number | null): string {
  if (value === null || value === undefined) return '--'
  return `${Number(value).toFixed(2)}T`
}

export function fmtCompact(value: number | null): string {
  if (value === null || value === undefined) return '--'
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  return Number(value).toFixed(2)
}
