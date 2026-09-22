import { useEffect, useMemo, useRef, useState } from 'react'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { ErrorState } from '../ui/States'
import { MacroCard } from '../ui/MacroCard'
import { StatTile } from '../ui/StatTile'
import { WinRateMeter } from '../ui/WinRateMeter'
import { Tooltip } from '../ui/Tooltip'
import { fmt, fmtTrillions } from '../../lib/core'
import { REGIME_DIR, REGIME_LABELS, type Dir } from '../../lib/regimeMeta'

type SignalInput = {
  id: string
  module: string
  title: string
  direction: Dir
  confidence: number
  evidence: string[]
  link?: string
  pending?: boolean
  error?: string
}

interface Aggregate {
  score: number
  label: string
  stance: string
  count: number
}

interface Tiles {
  sp500: number | null
  regimeLabel: string | null
  regimeMonths: number | null
  regimeConf: number | null
  gold: number | null
  dxy: number | null
  netLiq: number | null
  netLiqDelta: number | null
  totalAnom: number | null
  highAnom: number | null
}

type AnalysisTarget = {
  id: string
  module: string
  title: string
  url: string
  link: string
}

/**
 * 次级信号模块（首屏非必需，第二阶段加载）。
 * 注意：不再把「全球流动性」放在这里 —— 它走 /api/v1/analysis/liquidity.json
 * 的专用 signal 字段，已在 ESSENTIAL_URLS 单独拉取。
 */
const ANALYSIS_MODULES: AnalysisTarget[] = [
  { id: 'macro-consensus', module: '宏观共识', title: '宏观共识', url: '/api/v1/analysis/macro-consensus.json', link: '/analysis/macro-consensus' },
  { id: 'yield-curve', module: '收益率曲线', title: '收益率曲线体制', url: '/api/v1/analysis/yield-curve-regime.json', link: '/analysis/yield-curve' },
  { id: 'inflation-anchor', module: '通胀锚定', title: '通胀预期锚定', url: '/api/v1/analysis/inflation-anchor.json', link: '/analysis/inflation-anchor' },
  { id: 'cross-asset', module: '跨资产相关', title: '跨资产相关性', url: '/api/v1/analysis/cross-asset-correlation.json', link: '/analysis/cross-asset' },
  { id: 'credit-stress', module: '信用压力', title: '信用压力监测', url: '/api/v1/analysis/credit-stress.json', link: '/analysis/credit-stress' },
]

/**
 * 首屏必需 5 路：
 * - regime / anom / gold / liquidity-analysis：决定评分卡和顶部 6 个 StatTile
 * - regime/backtest：决定 S&P500 最新价 + 当前体制持续月数
 * 失败时单路降级为「数据源未就绪」，整页仍可渲染。
 */
const ESSENTIAL_URLS = [
  '/api/v1/regime.json',
  '/api/v1/regime/anomalies.json',
  '/api/v1/gold/correlation.json',
  '/api/v1/regime/backtest.json',
  '/api/v1/analysis/liquidity.json',
] as const

/**
 * 各分析模块 signal.direction 的取值不统一，这里统一映射到 -1/0/1。
 * 取值来源：sync/sync_*.py 中 6 个预计算脚本产出的 signal.direction。
 * 缺表的值返回 0，模块会被 active 过滤掉、不参与总分 —— 新增模块时务必在此登记。
 */
const DIRECTION_MAP: Record<string, Dir> = {
  bullish: 1,
  risk_on: 1,
  expansion: 1,
  positive: 1,
  bearish: -1,
  risk_off: -1,
  contraction: -1,
  negative: -1,
  dovish: 1,
  hawkish: -1,
}

function dirFromSignal(direction: string | undefined): Dir {
  if (!direction) return 0
  return DIRECTION_MAP[direction] ?? 0
}

type SourceState = 'pending' | 'ok' | 'failed'

interface SourceStatus {
  id: string
  label: string
  state: SourceState
  error?: string
}

function safeJson<T = any>(
  url: string,
  timeoutMs: number = 15000,
): Promise<{ ok: boolean; data: T | null; error?: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  // 只解析一次响应体：Worker / 网关崩溃时返回的是 HTML 错误页或
  // "error code: 1101" 这类纯文本，r.json() 会抛 "Unexpected token '<'"。
  // 这类瞬时故障按可重试错误处理；业务层错误（success: false）不重试。
  const once = async (): Promise<{ ok: boolean; data: T | null; error?: string }> => {
    const r = await fetch(url, { signal: ctrl.signal })
    const text = await r.text()
    try {
      const j = JSON.parse(text)
      return j.success
        ? { ok: true, data: j.data as T }
        : { ok: false, data: null, error: j.error }
    } catch {
      throw new Error(r.status >= 500 ? `数据源暂时不可用 (${r.status})` : '响应不是有效 JSON')
    }
  }

  const delay = (ms: number) => new Promise((res) => setTimeout(res, ms))
  const asAbort = (e: any) => e?.name === 'AbortError'
  const failure = (error?: string) => ({ ok: false as const, data: null, error })

  return once()
    .catch((first: any) => {
      if (asAbort(first)) return failure('请求超时')
      return delay(800)
        .then(once)
        .catch((second: any) => failure(asAbort(second) ? '请求超时' : second?.message ?? '请求失败'))
    })
    .finally(() => clearTimeout(timer))
}

const EMPTY_RESULT: { ok: false; data: null; error?: string } = { ok: false, data: null }

function accentFor(dir: Dir): 'green' | 'red' | 'none' {
  if (dir === 1) return 'green'
  if (dir === -1) return 'red'
  return 'none'
}

function toneFor(dir: Dir): string {
  if (dir === 1) return 'text-up'
  if (dir === -1) return 'text-down'
  return 'text-ink-3'
}

function barFor(dir: Dir): string {
  if (dir === 1) return 'bg-up'
  if (dir === -1) return 'bg-down'
  return 'bg-ink-3'
}

function formatUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* --------------------------------------------------------------------------- */

function Gauge({ percent }: { percent: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-2xs uppercase tracking-wider text-ink-3">
        <span>防守</span>
        <span>风险偏好</span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-gradient-to-r from-down via-ink-3 to-up opacity-60">
        <span className="absolute inset-y-0 left-1/2 w-px bg-bg/70" aria-hidden="true" />
      </div>
      <div className="relative h-3">
        <span
          className="absolute top-0 h-3 w-[3px] -translate-x-1/2 rounded-sm bg-ink transition-[left] duration-3 ease-terminal"
          style={{ left: `${percent}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}

function SignalCard({ s }: { s: SignalInput }) {
  const dirLabel = s.direction === 1 ? '偏多' : s.direction === -1 ? '偏空' : '中性'

  if (s.pending) {
    return (
      <MacroCard className="flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-2xs uppercase tracking-wider text-ink-3">
              {s.module}
            </div>
            <div className="mt-2 h-4 w-3/4 skeleton rounded" />
          </div>
          <div className="h-5 w-10 skeleton rounded" />
        </div>
        <div className="mt-3 h-1 w-full skeleton rounded-full" />
        <div className="mt-3 flex gap-1">
          <div className="h-3.5 w-12 skeleton rounded-sm" />
          <div className="h-3.5 w-16 skeleton rounded-sm" />
        </div>
      </MacroCard>
    )
  }

  if (s.error) {
    return (
      <MacroCard className="flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-2xs uppercase tracking-wider text-ink-3">
              {s.module}
            </div>
            <h3 className="mt-0.5 truncate text-md font-semibold text-ink-2">
              数据源未就绪
            </h3>
          </div>
          <span className="shrink-0 rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-ink-3">
            --
          </span>
        </div>
        <p className="mt-3 text-2xs leading-relaxed text-ink-3">{s.error}</p>
      </MacroCard>
    )
  }

  return (
    <MacroCard accent={accentFor(s.direction)} className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-2xs uppercase tracking-wider text-ink-3">
            {s.module}
          </div>
          <h3 className="mt-0.5 truncate text-md font-semibold text-ink">{s.title}</h3>
        </div>
        <span className={`num shrink-0 text-lg font-bold ${toneFor(s.direction)}`}>
          {dirLabel}
        </span>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-2xs text-ink-3">
          <span>置信度</span>
          <span className="num">{s.confidence}%</span>
        </div>
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-surface-3"
          role="meter"
          aria-valuenow={s.confidence}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${s.module} 置信度`}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-3 ease-terminal ${barFor(s.direction)}`}
            style={{ width: `${Math.min(100, Math.max(0, s.confidence))}%` }}
          />
        </div>
      </div>

      {s.evidence.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {s.evidence.slice(0, 3).map((e, i) => (
            <Tooltip key={i} content={e}>
              <span className="max-w-full truncate rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-ink-2">
                {e}
              </span>
            </Tooltip>
          ))}
        </div>
      )}

      {s.link && (
        <a
          href={s.link}
          className="mt-3 inline-flex items-center gap-1 text-xs text-info transition-colors duration-1 ease-terminal hover:text-accent-hover"
        >
          查看模块详情 <span aria-hidden="true">→</span>
        </a>
      )}
    </MacroCard>
  )
}

function SourceStatusBar({
  sources,
  failedCount,
  onRetry,
}: {
  sources: SourceStatus[]
  failedCount: number
  onRetry: () => void
}) {
  if (sources.length === 0) return null
  return (
    <details className="rounded-md border border-line bg-surface px-3 py-1.5 text-2xs text-ink-3">
      <summary className="flex cursor-pointer items-center gap-2 select-none">
        <span className="font-mono uppercase tracking-wider">
          数据源状态
        </span>
        <span className="text-ink-2">
          {failedCount === 0 ? '全部就绪' : `${failedCount} 路失败`}
        </span>
        {failedCount > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onRetry()
            }}
            className="ml-auto rounded-sm border border-line px-1.5 py-0.5 text-2xs text-ink-2 transition-colors duration-1 ease-terminal hover:border-line-strong hover:bg-surface-2 hover:text-ink"
          >
            重试失败项
          </button>
        )}
      </summary>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {sources.map((s) => (
          <li key={s.id} className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                s.state === 'ok'
                  ? 'bg-up'
                  : s.state === 'failed'
                    ? 'bg-down'
                    : 'bg-ink-3 animate-pulse'
              }`}
            />
            <span className="truncate text-ink-2">{s.label}</span>
            {s.error && (
              <Tooltip content={s.error}>
                <span className="shrink-0 text-2xs text-down">失败</span>
              </Tooltip>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

/* --------------------------------------------------------------------------- */

function computeAggregate(rows: SignalInput[]): Aggregate {
  const active = rows.filter((r) => !r.pending && !r.error && r.direction !== 0)
  const totalW = active.reduce((s, r) => s + r.confidence, 0)
  const score =
    totalW > 0
      ? (active.reduce((s, r) => s + r.direction * r.confidence, 0) / totalW) * 100
      : 0
  const sN = Math.round(score)
  const label =
    sN >= 50
      ? '显著风险偏好'
      : sN >= 15
        ? '风险偏好偏强'
        : sN > -15
          ? '中性震荡'
          : sN > -50
            ? '谨慎防守'
            : '显著防守'
  let stance = ''
  if (sN >= 15)
    stance =
      '市场内部数据偏暖，风险资产（股票/商品）相对占优，增长与盈利预期未现逆转。'
  else if (sN > -15)
    stance = '信号多空交织，无一致方向，建议维持中性仓位并等待资金/价格确认。'
  else
    stance =
      '风险信号占据主导（异常告警 / 体制偏弱 / 金价高估等），优先控制回撤，保留现金与避险资产。'
  return { score: sN, label, stance, count: active.length }
}

/* --------------------------- 配置倾向（结论层） --------------------------- */

type Tilt = 'over' | 'neutral' | 'under'

interface AllocItem {
  asset: string
  tilt: Tilt
  basis: string
}

const TILT_LABEL: Record<Tilt, string> = { over: '超配', neutral: '中性', under: '低配' }
const TILT_TONE: Record<Tilt, string> = { over: 'text-up', neutral: 'text-ink-2', under: 'text-down' }

/**
 * 按「信号 → 资产」的传导方向把参与信号加权到 [-1,1]：
 * 正值 = 支持超配该资产。每类资产只吃语义明确的信号，避免黑箱总分复用到所有资产。
 */
function computeAllocation(rows: SignalInput[], agg: Aggregate): AllocItem[] {
  const usable = rows.filter((r) => !r.pending && !r.error && r.direction !== 0)
  const signed = (ids: string[], sign = 1, weight = (r: SignalInput) => r.confidence) => {
    let num = 0
    let den = 0
    for (const r of usable) {
      if (!ids.includes(r.id)) continue
      const w = weight(r)
      num += r.direction * w * sign
      den += w
    }
    return den > 0 ? num / den : null
  }
  const classify = (v: number | null): Tilt =>
    v == null ? 'neutral' : v >= 0.3 ? 'over' : v <= -0.3 ? 'under' : 'neutral'
  const parts = (ids: string[]) =>
    usable.filter((r) => ids.includes(r.id)).map((r) => r.module).join(' + ') || '暂无参与信号'

  // 股票/风险资产：直接用综合分（board 的全部信号）
  const eqV = agg.count > 0 ? agg.score / 100 : null
  // 黄金：自身定价信号 + 流动性传导（扩表利多黄金）
  const goldRaw = signed(['gold'], 1)
  const goldLiq = signed(['liquidity'], 1, (r) => r.confidence * 0.5)
  const goldV = goldRaw != null && goldLiq != null ? (goldRaw + goldLiq) / 2 : goldRaw ?? goldLiq
  // 国债等防守债券：信用/风险信号走避险方向（risk_off → 利多债券 = 取反）
  const bondV = signed(['credit-stress', 'yield-curve', 'anomalies'], -1)
  // 现金：整体防守时超配（等待成本低的期权价值），进攻时低配
  const cashV = agg.count > 0 ? (agg.score <= -15 ? 0.5 : agg.score >= 15 ? -0.5 : 0) : null

  return [
    { asset: '股票 / 风险资产', tilt: classify(eqV), basis: `综合评分 ${agg.count} 路信号加权 → ${agg.label}` },
    { asset: '黄金', tilt: classify(goldV), basis: `依据：${parts(['gold', 'liquidity'])}` },
    { asset: '国债 / 防守债券', tilt: classify(bondV), basis: `依据：${parts(['credit-stress', 'yield-curve', 'anomalies'])}（避险方向）` },
    { asset: '现金', tilt: classify(cashV), basis: agg.count > 0 ? `整体立场 ${agg.label}，防守期保留再配置期权` : '暂无信号' },
  ]
}

/** 数据陈旧判定：库内快照距今 > staleDays 个自然日 → 同步可能断档 */
function staleDaysOf(updatedAtIso: string | null | undefined, nowMs: number): number | null {
  if (!updatedAtIso) return null
  const d = new Date(updatedAtIso)
  if (isNaN(d.getTime())) return null
  const days = (nowMs - d.getTime()) / 86_400_000
  return days > 3 ? Math.floor(days) : null
}

/* --------------------------- 信号战绩（记分卡） --------------------------- */

interface TrackSummaryRow {
  regime: string
  count: number
  avgReturn1m: number
  avgReturn3m: number
  avgReturn6m: number
  avgReturn12m: number
  winRate1m: number
  winRate3m: number
  winRate6m: number
  winRate12m: number
}

export function SignalBoardDashboard() {
  const [essentialsDone, setEssentialsDone] = useState(false)
  const [detailsDone, setDetailsDone] = useState(false)
  const [signals, setSignals] = useState<SignalInput[]>([])
  const [tiles, setTiles] = useState<Tiles>({
    sp500: null,
    regimeLabel: null,
    regimeMonths: null,
    regimeConf: null,
    gold: null,
    dxy: null,
    netLiq: null,
    netLiqDelta: null,
    totalAnom: null,
    highAnom: null,
  })
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [trackRecord, setTrackRecord] = useState<{ nameZh: string; row: TrackSummaryRow } | null>(null)
  const [sources, setSources] = useState<SourceStatus[]>([])
  const retryKeyRef = useRef(0)

  const load = () => {
    const myKey = ++retryKeyRef.current
    const isStale = () => myKey !== retryKeyRef.current
    const updateSource = (id: string, state: SourceState, error?: string) => {
      setSources((prev) =>
        prev.map((s) => (s.id === id ? { ...s, state, error } : s)),
      )
    }

    setEssentialsDone(false)
    setDetailsDone(false)

    // 初始化源状态（pending），让用户立刻看到「在加载什么」
    setSources([
      { id: 'regime', label: '宏观体制', state: 'pending' },
      { id: 'anomalies', label: '风险异常', state: 'pending' },
      { id: 'gold', label: '黄金', state: 'pending' },
      { id: 'backtest', label: '回测快照', state: 'pending' },
      { id: 'liquidity', label: '全球流动性', state: 'pending' },
      ...ANALYSIS_MODULES.map((m) => ({ id: m.id, label: m.module, state: 'pending' as SourceState })),
    ])

    // 预占位：让信号网格立刻出现骨架卡片（按所有模块的并集）
    setSignals([
      { id: 'regime', module: '宏观体制', title: '', direction: 0, confidence: 0, evidence: [], link: '/signals/regime', pending: true },
      { id: 'anomalies', module: '风险异常', title: '', direction: 0, confidence: 0, evidence: [], link: '/signals/regime#anomalies', pending: true },
      { id: 'gold', module: '黄金', title: '', direction: 0, confidence: 0, evidence: [], link: '/signals/gold', pending: true },
      { id: 'liquidity', module: '全球流动性', title: '', direction: 0, confidence: 0, evidence: [], link: '/indicators/global-liquidity', pending: true },
      ...ANALYSIS_MODULES.map((m) => ({
        id: m.id, module: m.module, title: m.title, direction: 0 as Dir, confidence: 0, evidence: [], link: m.link, pending: true,
      })),
    ])

    /* ---------- 第一阶段：5 路核心数据，首屏必需 ---------- */
    const applyEssential = (res: { ok: boolean; data: any | null; error?: string }[]) => {
      if (isStale()) return
      const [regime, anom, gold, backtest, liq] = res
      const newSignals: SignalInput[] = []
      const newTiles: Tiles = {
        sp500: null, regimeLabel: null, regimeMonths: null, regimeConf: null,
        gold: null, dxy: null, netLiq: null, netLiqDelta: null,
        totalAnom: null, highAnom: null,
      }
      let asof: string | null = null

      if (regime.ok && regime.data) {
        const r = regime.data
        newTiles.regimeLabel = r.label ?? null
        newTiles.regimeConf = r.confidence ?? null
        if (r.updatedAt) asof = r.updatedAt
        newSignals.push({
          id: 'regime', module: '宏观体制',
          title: `${r.label}（${r.regime}）`,
          direction: REGIME_DIR[r.regime] ?? 0,
          confidence: r.confidence,
          evidence: (r.signals || []).slice(0, 6).map(
            (s: any) => `${s.name}: ${s.value}（${s.score === 1 ? '利好' : s.score === -1 ? '利空' : '中性'}）`,
          ),
          link: '/signals/regime',
        })
      }

      if (anom.ok && anom.data) {
        const a = anom.data
        newTiles.totalAnom = a.totalCount ?? 0
        newTiles.highAnom = a.highCount ?? 0
        if (a.updatedAt) asof = a.updatedAt
        newSignals.push({
          id: 'anomalies', module: '风险异常',
          title: `${a.totalCount} 项异常告警（高/严重 ${a.highCount} 项）`,
          direction: a.highCount >= 2 ? -1 : 0,
          confidence: Math.min(80, (a.totalCount || 0) * 15),
          evidence: (a.anomalies || []).slice(0, 5).map((x: any) => `${x.title}: ${x.description}`),
          link: '/signals/regime#anomalies',
        })
      }

      if (gold.ok && gold.data) {
        const s = gold.data.signal
        newTiles.gold = gold.data.latest?.gold ?? null
        newTiles.dxy = gold.data.latest?.dxy ?? null
        newSignals.push({
          id: 'gold', module: '黄金',
          title: s.title,
          direction: s.direction === 'bullish' ? 1 : s.direction === 'bearish' ? -1 : 0,
          confidence: s.confidence ?? 50,
          evidence: (s.evidence || []).slice(0, 5),
          link: '/signals/gold',
        })
      }

      if (backtest.ok && backtest.data) {
        const snaps = backtest.data.snapshots ?? []
        const lastValid = [...snaps].reverse().find((s: any) => s.sp500Price > 0)
        newTiles.sp500 = lastValid ? lastValid.sp500Price : null
        if (lastValid) {
          // 从末尾回溯「体制连续相同」的周快照段，周频 ÷4.345 折算为月数
          let runWeeks = 0
          for (let i = snaps.length - 1; i >= 0; i--) {
            if (snaps[i].regime !== lastValid.regime) break
            runWeeks++
          }
          newTiles.regimeMonths = runWeeks > 0 ? Math.max(1, Math.round(runWeeks / 4.345)) : null
        }
        // 战绩记分卡：当前体制在指数回测摘要中的历史前瞻表现（优先标普500）
        const idxList: any[] = backtest.data.indexSummaries ?? []
        const sp = idxList.find((x: any) => x.symbol === '^GSPC') ?? idxList[0]
        const row = sp && lastValid ? sp.rows?.find((r: any) => r.regime === lastValid.regime) ?? null : null
        setTrackRecord(sp && row ? { nameZh: String(sp.nameZh ?? '').replace('指数', ''), row } : null)
      } else {
        setTrackRecord(null)
      }

      if (liq.ok && liq.data) {
        const s = liq.data.signal
        const c = liq.data.current
        if (s && c) {
          newTiles.netLiq = c.netLiquidityTrn ?? null
          newTiles.netLiqDelta = c.weeklyChangeTrn ?? null
          newSignals.push({
            id: 'liquidity', module: '全球流动性',
            title: `净流动性 ${c.netLiquidityTrn?.toFixed(2) ?? '--'}T · ${s.direction === 'expansion' ? '扩张' : s.direction === 'contraction' ? '收缩' : '中性'}`,
            direction: dirFromSignal(s.direction),
            confidence: s.confidence ?? 50,
            evidence: (s.evidence || []).slice(0, 3).map(String),
            link: '/indicators/global-liquidity',
          })
        }
      }

      // 失败模块：用 error 占位保留卡片位置
      const failedEssentials: Record<string, string> = {}
      const ids = ['regime', 'anomalies', 'gold', 'liquidity']
      ids.forEach((id, i) => {
        const r = [regime, anom, gold, liq][i]
        if (!r.ok) {
          failedEssentials[id] = r.error || '该数据源加载失败'
        }
      })
      if (!backtest.ok) failedEssentials['regime'] = (failedEssentials['regime'] ?? '') + '（回测快照未就绪）'

      // 合并：未到的 detail 卡片保留 pending
      setSignals((prev) => {
        const map = new Map<string, SignalInput>()
        for (const s of prev) map.set(s.id, s)
        for (const s of newSignals) map.set(s.id, s)
        for (const [id, err] of Object.entries(failedEssentials)) {
          const existing = map.get(id)
          if (existing) {
            map.set(id, { ...existing, pending: false, error: err, evidence: [], confidence: 0, direction: 0 })
          }
        }
        // 保留 detail 阶段的 pending 卡片
        return [...map.values()]
      })

      setTiles((prev) => ({ ...prev, ...newTiles }))
      if (asof) setUpdatedAt(asof)
      setEssentialsDone(true)
    }

    const markSource = (id: string, r: { ok: boolean; error?: string }) => {
      updateSource(id, r.ok ? 'ok' : 'failed', r.ok ? undefined : r.error)
    }

    // 启动 5 路并行
    const essentialPromises = ESSENTIAL_URLS.map((url) => safeJson<any>(url))
    void Promise.allSettled(essentialPromises).then((settled) => {
      if (isStale()) return
      const res = settled.map((s) => (s.status === 'fulfilled' ? s.value : EMPTY_RESULT))
      // 标记 5 个源状态
      markSource('regime', res[0])
      markSource('anomalies', res[1])
      markSource('gold', res[2])
      markSource('backtest', res[3])
      markSource('liquidity', res[4])
      applyEssential(res)
    })

    /* ---------- 第二阶段：5 路次级信号，可延迟 ---------- */
    void Promise.allSettled(ANALYSIS_MODULES.map((m) => safeJson<any>(m.url))).then((settled) => {
      if (isStale()) return
      const updates: SignalInput[] = []
      ANALYSIS_MODULES.forEach((cfg, i) => {
        const r = settled[i].status === 'fulfilled' ? settled[i].value : EMPTY_RESULT
        markSource(cfg.id, r)
        if (r.ok && r.data?.signal) {
          const sig = r.data.signal
          updates.push({
            id: cfg.id, module: cfg.module, title: cfg.title,
            direction: dirFromSignal(sig.direction),
            confidence: Math.round(sig.confidence ?? 50),
            evidence: Array.isArray(sig.evidence) ? sig.evidence.slice(0, 3).map(String) : [],
            link: cfg.link, pending: false,
          })
        } else {
          updates.push({
            id: cfg.id, module: cfg.module, title: cfg.title,
            direction: 0, confidence: 0, evidence: [], link: cfg.link,
            pending: false, error: r.error || '该数据源加载失败',
          })
        }
      })
      setSignals((prev) => {
        const map = new Map<string, SignalInput>()
        for (const s of prev) map.set(s.id, s)
        for (const s of updates) map.set(s.id, s)
        return [...map.values()]
      })
      setDetailsDone(true)
    })
  }

  useEffect(load, [])

  const agg = useMemo(() => computeAggregate(signals), [signals])
  const alloc = useMemo(() => computeAllocation(signals, agg), [signals, agg])
  const staleDays = staleDaysOf(updatedAt, Date.now())
  const failedCount = sources.filter((s) => s.state === 'failed').length
  const isLoading = !essentialsDone || !detailsDone
  const hasAnySignal = signals.some((s) => !s.pending && !s.error)

  // 没有任何一路成功时显示错误态
  if (essentialsDone && detailsDone && !hasAnySignal) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorState message="所有数据源均加载失败，请稍后重试。" onRetry={load} />
        <SourceStatusBar sources={sources} failedCount={failedCount} onRetry={load} />
      </div>
    )
  }

  const gaugePercent = Math.min(95, Math.max(5, (agg.score + 100) / 2))
  const scoreTone =
    agg.score >= 15 ? 'text-up' : agg.score <= -15 ? 'text-down' : 'text-ink-2'
  const updatedLabel = formatUpdatedAt(updatedAt)

  // 风险异常：数据未到齐时显示「--」而不是「0 / 0」误导文案
  const anomValue =
    tiles.totalAnom == null
      ? '--'
      : tiles.totalAnom === 0
        ? '无'
        : `${tiles.highAnom ?? 0} / ${tiles.totalAnom}`
  const anomSub =
    tiles.totalAnom == null
      ? '加载中…'
      : tiles.totalAnom === 0
        ? '当前无异常告警'
        : '高/严重 / 总数'
  const anomTone = tiles.highAnom == null ? 'neutral' : tiles.highAnom > 0 ? 'warn' : 'up'
  const anomAccent = tiles.highAnom == null ? 'none' : tiles.highAnom > 0 ? 'red' : 'green'

  return (
    <div className="flex flex-col gap-4">
      {/* 数据陈旧告警：updatedAt 超过 3 天说明同步断档 */}
      {staleDays != null && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-xs"
        >
          <span className="font-semibold text-warn">数据已 {staleDays} 天未更新</span>
          <span className="text-ink-2">
            定时同步可能失败（见 GitHub Actions / 数据同步 issue），以下信号与结论可能滞后，请以刷新后为准。
          </span>
        </div>
      )}

      {/* 综合评分（首屏核心 5 路就绪后才填充，否则只显示骨架） */}
      <MacroCard variant="elevated">
        {!essentialsDone ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-end gap-4">
              <div className="h-10 w-20 skeleton rounded" />
              <div className="h-3 w-32 skeleton rounded" />
            </div>
            <div className="h-3 w-full max-w-xl skeleton rounded" />
            <div className="h-3 w-2/3 skeleton rounded" />
          </div>
        ) : (
          <div className="grid items-center gap-5 md:grid-cols-[auto_1fr] lg:grid-cols-[auto_1fr_minmax(160px,220px)]">
            <div className="text-center md:text-left">
              <div className={`num text-4xl font-bold leading-none ${scoreTone}`}>
                {agg.score >= 0 ? '+' : ''}
                {agg.score}
              </div>
              <div className="mt-1 text-xs tracking-wide text-ink-3">{agg.label}</div>
            </div>
            <div className="min-w-0">
              <div className="font-mono text-2xs text-ink-3">
                {agg.count} 路实体信号加权 · 权重 = 信号置信度
                {updatedLabel && (
                  <span className="ml-2 text-ink-3/80">更新于 {updatedLabel}</span>
                )}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
                <strong className="font-medium text-ink">今日推演：</strong>
                {agg.stance}
              </p>
            </div>
            <div className="md:col-span-2 lg:col-span-1">
              <Gauge percent={gaugePercent} />
            </div>
          </div>
        )}

        {/* 配置倾向结论：结论层输出，每类资产只吃语义明确的信号 */}
        {essentialsDone && agg.count > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-mono text-2xs uppercase tracking-wider text-ink-3">配置倾向</span>
              <span className="text-2xs text-ink-3">由参与信号方向加权推导 · 研究参考</span>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {alloc.map((a) => (
                <div key={a.asset} className="rounded-md border border-line bg-surface-2 px-3 py-2">
                  <div className="text-2xs text-ink-2">{a.asset}</div>
                  <div className={`num mt-0.5 text-base font-bold ${TILT_TONE[a.tilt]}`}>
                    {TILT_LABEL[a.tilt]}
                  </div>
                  <div className="mt-1 text-2xs leading-snug text-ink-3">{a.basis}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </MacroCard>

      {/* 顶部 6 个核心指标：3×2 网格，失败显示 -- 而非 0 */}
      <div className="grid gap-2 sm:grid-cols-3">
        <StatTile
          label="S&P500 最新"
          value={tiles.sp500 != null ? `$${tiles.sp500.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '--'}
          sub={
            !essentialsDone
              ? '加载中…'
              : tiles.regimeLabel && tiles.regimeMonths != null
                ? `${tiles.regimeLabel} · ${tiles.regimeMonths} 月`
                : tiles.regimeLabel ?? '体制未就绪'
          }
          accent="blue"
        />
        <StatTile
          label="金价 / 美元指数"
          value={tiles.gold != null ? fmt(tiles.gold) : '--'}
          sub={tiles.dxy != null ? `DXY ${fmt(tiles.dxy)}` : '美元指数未就绪'}
          accent="gold"
        />
        <StatTile
          label="净流动性"
          value={fmtTrillions(tiles.netLiq)}
          sub={
            tiles.netLiqDelta != null
              ? `${tiles.netLiqDelta >= 0 ? '+' : ''}${tiles.netLiqDelta.toFixed(2)}T / 周`
              : '6 月窗口'
          }
          accent="cyan"
          tone={tiles.netLiqDelta != null && tiles.netLiqDelta < 0 ? 'down' : 'neutral'}
        />
        <StatTile
          label="风险异常"
          value={anomValue}
          sub={anomSub}
          accent={anomAccent}
          tone={anomTone}
        />
        <StatTile
          label="体制置信度"
          value={tiles.regimeConf != null ? `${tiles.regimeConf}%` : '--'}
          sub={tiles.regimeLabel ?? (essentialsDone ? '体制未就绪' : '加载中…')}
          accent={tiles.regimeConf != null && tiles.regimeConf > 60 ? 'green' : 'gold'}
        />
        <StatTile
          label="加载进度"
          value={`${sources.filter((s) => s.state === 'ok').length} / ${sources.length}`}
          sub={isLoading ? '数据采集中…' : failedCount > 0 ? `${failedCount} 路失败` : '全部就绪'}
          accent={failedCount > 0 ? 'red' : 'green'}
        />
      </div>

      {/* 信号战绩：当前体制的历史前瞻表现（记分卡） */}
      {trackRecord && (
        <MacroCard
          title={`信号战绩 · 当前体制「${REGIME_LABELS[trackRecord.row.regime] ?? trackRecord.row.regime}」历史兑现`}
          padding="sm"
        >
          <p className="mb-2 text-2xs leading-relaxed text-ink-3">
            历史上该体制共出现 {trackRecord.row.count} 个月，{trackRecord.nameZh || '代表指数'}在其后 1/3/6/12 个月的平均涨跌幅与上涨概率（胜率）。
            这是当前体制信号的方向性证据，不构成对未来收益的保证。
          </p>
          {/* 兑现路径：4 个视野一排，收益方向着色 + 胜率进度条。
              这是用户最关心的卡片，做出与普通数据卡不同的视觉权重 */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {([
              ['1 个月后', trackRecord.row.avgReturn1m, trackRecord.row.winRate1m],
              ['3 个月后', trackRecord.row.avgReturn3m, trackRecord.row.winRate3m],
              ['6 个月后', trackRecord.row.avgReturn6m, trackRecord.row.winRate6m],
              ['12 个月后', trackRecord.row.avgReturn12m, trackRecord.row.winRate12m],
            ] as [string, number, number][]).map(([h, ret, win]) => {
              const positive = ret >= 0
              const strong = win >= 0.75
              return (
                <div
                  key={h}
                  className={`relative overflow-hidden rounded-md border px-3 py-2.5 ${
                    positive ? 'border-up/25 bg-up/5' : 'border-down/25 bg-down/5'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-2xs uppercase tracking-wider text-ink-3">{h}</span>
                    <span
                      className={`num rounded-sm border px-1 text-2xs ${
                        strong ? 'border-up/40 text-up' : 'border-line text-ink-2'
                      }`}
                    >
                      胜率 {Math.round(win * 100)}%
                    </span>
                  </div>
                  <div className={`num mt-1.5 text-xl font-bold leading-none ${positive ? 'text-up' : 'text-down'}`}>
                    {positive ? '▲' : '▼'} {(Math.abs(ret) * 100).toFixed(2)}%
                  </div>
                  <div className="mt-2.5">
                    <WinRateMeter value={win} />
                  </div>
                </div>
              )
            })}
          </div>
        </MacroCard>
      )}

      {/* 数据源状态（折叠） */}
      {sources.length > 0 && (
        <SourceStatusBar sources={sources} failedCount={failedCount} onRetry={load} />
      )}

      {/* 各模块信号卡 */}
      <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {signals.map((s) => (
          <SignalCard key={s.id} s={s} />
        ))}
        {isLoading && signals.length === 0 && (
          <>
            <LoadingSkeleton type="card" rows={3} height={140} />
            <LoadingSkeleton type="card" rows={3} height={140} />
            <LoadingSkeleton type="card" rows={3} height={140} />
          </>
        )}
      </div>

      <p className="text-xs leading-relaxed text-ink-3">
        组合信号板为多模块信号加权研究工具：权重 = 各信号置信度（黄金定价残差、宏观体制、风险异常、宏观共识、收益率曲线、通胀锚定、跨资产相关性、信用压力、全球流动性）。所有结论均附证据链，仅供研究参考，不构成投资建议。
      </p>
    </div>
  )
}
