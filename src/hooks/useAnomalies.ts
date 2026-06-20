import { useEffect, useState } from 'react'
import { fetchApi } from '../lib/api'
import type { AnomalyResponse } from '@invest/core'

export function useAnomalies() {
  const [data, setData] = useState<AnomalyResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const fetch = () => {
      fetchApi<AnomalyResponse>('/regime/anomalies')
        .then(r => { if (!cancelled) setData(r); setLoading(false) })
        .catch(() => { if (!cancelled) setLoading(false) })
    }
    fetch()
    const interval = setInterval(fetch, 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  return { data, loading }
}
