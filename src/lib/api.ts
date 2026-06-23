const API_BASE = import.meta.env.API_BASE || '/api/v1'

interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

export async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Accept': 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText} for ${path}`)
  }
  const json: ApiResult<T> = await res.json()
  if (!json.success || !json.data) {
    throw new Error(json.error || `API returned success:false for ${path}`)
  }
  return json.data
}

export interface UsSnapshotData {
  header: { date: string; status: string; conclusion: string }
  coreIndices: Array<{ symbol: string; name: string; price: number; change: number }>
  macroRisk: Array<{ code: string; name: string; value: number; unit: string }>
  summary: { evidence: string[]; falsify: string[]; action: string[] }
}

export interface CnSnapshotData {
  header: { tradeDate: string; sentiment: string; conclusion: string }
  indices: Array<{ symbol: string; name: string; price: number; change: number }>
  valuation: {
    overallPE?: number
    overallPB?: number
    overallSignal?: string
    industries: Array<{ name: string; pe?: number; pb?: number; stockCount?: number }>
  }
  summary: { evidence: string[]; falsify: string[]; action: string[] }
}
