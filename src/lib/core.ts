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
  sparkline?: { date: string; value: number }[]
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

// ── 全球流动性 ──
export type LiquidityIndicatorCode =
  | 'FED_BALANCE_SHEET'
  | 'FED_RRP'
  | 'FED_TGA'
  | 'SOFR'
  | 'ECB_BALANCE_SHEET'
  | 'BOJ_BALANCE_SHEET'
  // 流动性缺口补齐：政策利率底 + 准备金水位 + 货币供应
  | 'IORB'
  | 'BANK_RESERVES'
  | 'M1'
  | 'M2'

export interface LiquiditySeries {
  code: LiquidityIndicatorCode
  nameZh: string
  nameEn: string
  unit: string
  frequency: string
  data: { date: string; value: number | null }[]
}

/** M1 / M2 同比与剪刀差，月频对齐 */
export interface MoneySupplyPoint {
  date: string
  m1Yoy: number | null
  m2Yoy: number | null
  /** 剪刀差 = M1同比 − M2同比。转负常对应资金活化不足 / 通缩压力 */
  scissors: number | null
}

export interface GlobalLiquidityResponse {
  series: LiquiditySeries[]
  updatedAt: string
  netLiquidity?: { date: string; value: number }[]
  /** SOFR − IORB，单位：基点。转正 = 回购融资成本高于政策利率底，市场缺钱 */
  sofrIorbSpread?: { date: string; value: number }[]
  moneySupply?: MoneySupplyPoint[]
}

// ── 大宗商品 ──
export type CommodityCode = 'WTI' | 'BRENT' | 'NATGAS' | 'COPPER' | 'IRON_ORE' | 'GLOBAL_COMM_IDX'

export interface CommoditySeries {
  code: CommodityCode
  nameZh: string
  nameEn: string
  unit: string
  frequency: string
  data: { date: string; value: number | null }[]
}

/** 商品的相对价值信号 */
export interface CommoditySpreadPoint {
  date: string
  /** 布伦特 − WTI，反映跨区供需与运输瓶颈 */
  brentWti: number | null
  /** 金油比 = 金价(美元/盎司) ÷ WTI(美元/桶) */
  goldOilRatio: number | null
}

export interface CommodityResponse {
  series: CommoditySeries[]
  updatedAt: string
  spreads: CommoditySpreadPoint[]
}

// ── 领先指标 ──
export type LeadingCode =
  | 'NFCI'
  | 'ICSA'
  | 'UNRATE'
  | 'PAYEMS'
  | 'INDPRO'
  | 'CAPACITY_UTIL'
  | 'PERMIT'
  | 'CORE_CAPEX_ORDERS'
  | 'CONSUMER_SENT'
  | 'DE_IP'
  | 'JP_IP'
  | 'GB_IP'
  | 'CA_IP'

export interface LeadingSeries {
  code: LeadingCode
  nameZh: string
  nameEn: string
  unit: string
  frequency: string
  data: { date: string; value: number | null }[]
}

/** G7（德/日/英/加）工业产出 12 月同比等权平均：全球景气共振代理 */
export interface G7IpPoint {
  date: string
  value: number | null
  /** 该月参与平均的国家数（1-4） */
  countries: number
}

/** Sahm Rule 判定结果 */
export interface SahmSignal {
  value: number | null
  threshold: number
  triggered: boolean
  status: string
}

export interface LeadingResponse {
  series: LeadingSeries[]
  updatedAt: string
  /** Sahm Rule：失业率 3 月均线 − 过去 12 个月该均线最低值 */
  sahm: { date: string; value: number | null }[]
  sahmSignal: SahmSignal
  /** G7 IP 12 月同比等权平均（德国/日本/英国/加拿大） */
  g7IpYoy?: G7IpPoint[]
}

// ── Nowcast ──
export type NowcastSource = 'GDPNow' | 'NYFed'

export interface NowcastSeries {
  source: NowcastSource
  data: { date: string; value: number | null }[]
}

export interface NowcastResponse {
  gdpNow: { date: string; value: number | null }[]
  nyFed: { date: string; value: number | null }[]
  updatedAt: string
}

// ── 股票风险溢价 / 周期 vs 防御 ──
export type EquityCode =
  | 'BAMLC0A4CBBB'  // BBB OAS
  | 'BAMLH0A0HYM2'  // HY OAS
  | 'DFII10'         // 10Y TIPS 实际利率
  | 'XLI' | 'XLY' | 'XLE' | 'XLB' | 'XLU' | 'XLP'

export interface EquityCycleComponent {
  code: string
  nameZh: string
  bucket: 'cyclical' | 'defensive'
  /** 月末归一化（首期 = 100） */
  data: { date: string; value: number | null }[]
}

export interface EquityCycleResponse {
  /** HY OAS − BBB OAS（基点）；上行 = 信用下沉溢价扩大，<200bp 警惕下沉拥挤 */
  hyBbbSpread: { date: string; value: number | null }[]
  /** 10Y TIPS 实际利率（%）；上行 → 贴现率压顶 */
  realRate: { date: string; value: number | null }[]
  /** 周期等权 / 防御等权（首日=100 归一化）；>1 偏周期 */
  cyclicalDefensiveRatio: { date: string; value: number | null }[]
  cyclicalComponents: EquityCycleComponent[]
  updatedAt: string
}

// ── 信贷脉冲 ──
export interface CreditPulsePoint {
  reportDate: string
  tsfStock: number | null
  tsfIncrement: number | null
  nominalGdp: number | null
  creditPulse: number | null
  mediumLongLoanEnt: number | null
  mediumLongLoanHh: number | null
  shadowBanking: number | null
}

export interface CreditPulseResponse {
  points: CreditPulsePoint[]
  csi300History: { date: string; value: number | null }[]
  usCreditPulse: { date: string; value: number | null }[]
  updatedAt: string
}
