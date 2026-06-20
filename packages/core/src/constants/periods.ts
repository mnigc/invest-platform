export const PERIOD_MAP = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '5Y': 1825,
  '10Y': 3650,
} as const

export type PeriodKey = keyof typeof PERIOD_MAP

export const PERIOD_LIST = ['1M', '3M', '6M', '1Y', '5Y', '10Y', 'MAX'] as const

export function getDays(period: string): number {
  if (period === 'MAX') return 99999
  return PERIOD_MAP[period as PeriodKey] || PERIOD_MAP['10Y']
}
