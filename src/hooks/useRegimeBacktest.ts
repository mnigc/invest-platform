import { useEffect, useState } from 'react'
import { fetchApi } from '../lib/api'
import type { BacktestResponse } from '@invest/core'

export function useRegimeBacktest(startDate = '2010-01-01', endDate?: string) {
  const [data, setData] = useState<BacktestResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    const end = endDate || new Date().toISOString().slice(0, 10)
    fetchApi<BacktestResponse>(`/regime/backtest?startDate=${startDate}&endDate=${end}`)
      .then(r => { if (!cancelled) { setData(r); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [startDate, endDate])

  return { data, loading, error }
}
