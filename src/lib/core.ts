// ── Types ──

export interface Indicator {
  code: string
  name_zh: string
  name_en?: string
  region: 'US' | 'CN' | 'GLOBAL'
  category: string
  sub_category?: string
  unit: string
  frequency: string
  source?: string
}

export interface DataPoint {
  period_date: string
  value: number | null
  cnt?: number
  expected_cnt?: number
}

export interface ApiMeta {
  updatedAt: string
  source: string
  cachedAt?: string
}

export interface ApiResponse<T> {
  success: true
  data: T
  meta?: ApiMeta
}

export interface ApiError {
  success: false
  error: string
}

export type ApiResult<T> = ApiResponse<T> | ApiError

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

export interface YieldCurvePoint {
  tenor: string
  yield: number
  change?: number
}

export interface BondSpread {
  label: string
  value: number
  change?: number
  percentile5y?: number
}

export interface YieldCurveResponse {
  country: string
  date: string
  curve: YieldCurvePoint[]
  spreads: BondSpread[]
}

// ── 曲线形态判定 ──
export type CurveShape = 'steepening' | 'flattening' | 'inverted' | 'normal'

export interface CurveShapeAssessment {
  shape: CurveShape
  label: string
  description: string
  // 10Y-2Y 利差（bp）
  spread10y2y: number | null
  // 10Y-2Y 历史分位（0-100）
  spreadPercentile1y: number | null
  spreadPercentile5y: number | null
}

// ── 中美利差 ──
export interface CnUsSpreadPoint {
  date: string
  cn10y: number | null
  us10y: number | null
  spread: number | null
}

export interface CnUsSpreadResponse {
  latestDate: string
  latest: {
    cn10y: number | null
    us10y: number | null
    spread: number | null
    change: number | null
  }
  history: CnUsSpreadPoint[]
  // 警戒线（如 -100bp / -150bp）
  warningLines: { label: string; valueBp: number }[]
  // 历史分位
  percentile1y: number | null
  percentile5y: number | null
  // 历史倒挂次数（spread < 0 持续 >= 5 交易日）
  inversionCount: number
}

// ── Nelson-Siegel 三因子分解 ──
export interface NelsonSiegelFactors {
  date: string
  level: number | null   // β0 水平因子
  slope: number | null   // β1 斜率因子
  curvature: number | null // β2 曲率因子
}

export interface CurveDynamicsResponse {
  country: string
  lambda: number
  history: NelsonSiegelFactors[]
  latest: NelsonSiegelFactors | null
  // 三因子历史分位
  percentiles: {
    level: number | null
    slope: number | null
    curvature: number | null
  }
  // 拟合优度
  latestRmse: number | null
}

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
  forwardReturns: { 1: number; 3: number; 6: number; 12: number }
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

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical'

export interface Anomaly {
  id: string
  title: string
  description: string
  severity: AnomalySeverity
  indicator: string
  currentValue: string
  threshold: string
  detail?: string
}

export interface AnomalyResponse {
  anomalies: Anomaly[]
  totalCount: number
  highCount: number
  updatedAt: string
}

// ── Constants ──

export const PERIOD_MAP: Record<string, number> = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '5Y': 1825,
  '10Y': 3650,
}

export type PeriodKey = keyof typeof PERIOD_MAP

export const PERIOD_LIST = ['1M', '3M', '6M', '1Y', '5Y', '10Y', 'MAX'] as const

export function getDays(period: string): number {
  if (period === 'MAX') return 99999
  return PERIOD_MAP[period as PeriodKey] || PERIOD_MAP['10Y']
}

const TRIL: Record<string, Record<string, number>> = {
  US: { GDP: 0.001, PCE: 0.001, RSXFS: 0.000001 },
  CN: { GDP: 0.0001, RETAIL: 0.0001 },
}

export function applyScaling(region: string, code: string, value: number): number {
  const factor = TRIL[region]?.[code]
  return factor ? value * factor : value
}

// ── Utils ──

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
