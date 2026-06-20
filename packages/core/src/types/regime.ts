export type RegimeType =
  | 'GOLDILOCKS'
  | 'RISK_ON'
  | 'OVERHEAT'
  | 'STAGFLATION'
  | 'RISK_OFF'
  | 'RECOVERY'
  | 'UNKNOWN'

export interface RegimeSignal {
  name: string
  value: number | string
  score: -1 | 0 | 1
  detail?: string
}

export interface RegimeResponse {
  regime: RegimeType
  label: string
  confidence: number
  signals: RegimeSignal[]
  updatedAt: string
}

export interface BacktestSnapshot {
  date: string
  regime: RegimeType
  label: string
  confidence: number
  sp500Price: number
  forwardReturns: {
    1: number
    3: number
    6: number
    12: number
  }
}

export interface BacktestSummary {
  regime: RegimeType
  label: string
  count: number
  avgConfidence: number
  avgReturn1m: number
  avgReturn3m: number
  avgReturn6m: number
  avgReturn12m: number
  winRate1m: number
  winRate3m: number
  winRate6m: number
  winRate12m: number
}

export interface BacktestResponse {
  snapshots: BacktestSnapshot[]
  summaries: BacktestSummary[]
  overall: {
    startDate: string
    endDate: string
    totalSnapshots: number
    avgReturn1m: number
    avgReturn3m: number
    avgReturn6m: number
    avgReturn12m: number
  }
}
