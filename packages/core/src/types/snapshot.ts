export interface UsCoreIndex {
  symbol: string
  name: string
  price: number
  change: number
  volume?: number
}

export interface UsSectorData {
  symbol: string
  name: string
  change: number
  flow?: number
}

export interface UsMacroRiskData {
  indicator: string
  value: number
  change?: number
  status: 'normal' | 'warning' | 'danger'
}

export interface UsSnapshot {
  header: { date: string; status: string; conclusion: string }
  regime: { trend: 'bull' | 'bear' | 'neutral'; risk: 'low' | 'medium' | 'high' }
  coreIndices: UsCoreIndex[]
  sectorTheme: UsSectorData[]
  macroRisk: UsMacroRiskData[]
  summary: { evidence: string[]; falsify: string[]; action: string[] }
}

export interface CnIndexData {
  symbol: string
  name: string
  price: number
  change: number
}

export interface CnSectorData {
  name: string
  change: number
  netFlow?: number
}

export interface CnSnapshot {
  header: { tradeDate: string; sentiment: string; conclusion: string }
  indices: CnIndexData[]
  sectors: CnSectorData[]
  fundFlow: { northbound: number; southbound: number; margin: number }
  summary: { evidence: string[]; falsify: string[]; action: string[] }
}
