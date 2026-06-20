import { useQuery } from '@tanstack/react-query'
import { fetchApi, type Indicator } from '../lib/api'

export interface IndicatorDataPoint {
  period_date: string
  value: number
  cnt?: number
  expected_cnt?: number
}

export interface IndicatorData {
  indicator: Indicator
  points: IndicatorDataPoint[]
}

export function useIndicators() {
  return useQuery({
    queryKey: ['indicators'],
    queryFn: () => fetchApi<Indicator[]>('/indicators'),
  })
}

export function useIndicatorData(code: string, period?: string, yearly?: boolean) {
  const qp = new URLSearchParams()
  if (period) qp.set('period', period)
  qp.set('yearly', String(yearly ?? true))
  return useQuery({
    queryKey: ['indicator', code, period, yearly],
    queryFn: () => fetchApi<IndicatorData>(`/indicators/${code}?${qp}`),
    enabled: !!code,
  })
}
