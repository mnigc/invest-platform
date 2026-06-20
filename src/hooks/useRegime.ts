import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '../lib/api'

export interface RegimeSignal {
  name: string
  value: number | string
  score: -1 | 0 | 1
  detail?: string
}

export interface RegimeData {
  regime: string
  label: string
  confidence: number
  signals: RegimeSignal[]
  updatedAt: string
}

export function useRegime() {
  return useQuery({
    queryKey: ['regime'],
    queryFn: () => fetchApi<RegimeData>('/regime.json'),
    refetchInterval: 30 * 60 * 1000,
  })
}
