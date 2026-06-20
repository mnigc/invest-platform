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
  sectorTheme: Array<{ symbol: string; name: string; change: number }>
  marketInternals: {
    breadth?: { advance: number; decline: number; newHigh: number; newLow: number }
    maDist?: { above20: number; above50: number; above200: number }
    mag7?: Array<{ symbol: string; name: string; change: number }>
    sox?: { price: number; change: number }
  }
  sentiment: {
    vix?: number
    putCallRatio?: number
    events?: Array<{ date: string; name: string; impact: string }>
    cta?: string
    gamma?: string
    watchPoints?: string[]
  }
  microAnomaly: {
    volume: Array<{ symbol: string; name: string; ratio: number; change: number }>
    options: Array<{ symbol: string; name: string; premium: number; direction: string }>
    momentum: Array<{ symbol: string; name: string; change: number; reason: string }>
    reversal: Array<{ symbol: string; name: string; change: number; reason: string }>
  }
  summary: { evidence: string[]; falsify: string[]; action: string[] }
}

export interface Indicator {
  code: string
  region: string
  name_zh: string
  unit: string
  frequency: string
}

export interface CnSnapshotData {
  header: { tradeDate: string; sentiment: string; conclusion: string }
  indices: Array<{ symbol: string; name: string; price: number; change: number }>
  styleIndices: Array<{ symbol: string; name: string; change: number }>
  sectors: Array<{ code: string; name: string; change: number; price?: number }>
  fundFlow: { northbound: number; southbound: number; margin: number }
  valuation: {
    overallPE?: number
    overallSignal?: string
    industries: Array<{ name: string; pe: number; pb: number; stockCount: number }>
  }
  summary: { evidence: string[]; falsify: string[]; action: string[] }
}
