import { useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { ErrorState, EmptyState } from '../ui/States'
import { MacroCard } from '../ui/MacroCard'
import { StatTile } from '../ui/StatTile'
import { Tooltip } from '../ui/Tooltip'
import { ResponsiveChartBox } from '../charts/ChartBox'
import { RegimeLegend } from './RegimeLegend'
import { useChartTheme } from '../ui/theme'
import { REGIME_DIR, type Dir } from '../../lib/regimeMeta'
import { regimeSegments, buildSp500RegimeOption } from '../../lib/regimeChart'
import { fmt, fmtTrillions } from '../../lib/core'
import type { BacktestSnapshot } from '../../lib/core'

type SignalInput = {
  id: string
  module: string
  title: string
  direction: Dir
  confidence: number
  evidence: string[]
  link?: string
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
  totalAnom: number
  highAnom: number
}

type AnalysisTarget = {
  id: string
  module: string
  title: string
  url: string
  link: string
}

const ANALYSIS_MODULES: AnalysisTarget[] = [
  { id: 'macro-consensus', module: '宏观共识', title: '宏观共识', url: '/api/v1/analysis/macro-consensus.json', link: '/analysis/macro-consensus' },
  { id: 'yield-curve', module: '收益率曲线', title: '收益率曲线体制', url: '/api/v1/analysis/yield-curve-regime.json', link: '/analysis/yield-curve' },
  { id: 'inflation-anchor', module: '通胀锚定', title: '通胀预期锚定', url: '/api/v1/analysis/inflation-anchor.json', link: '/analysis/inflation-anchor' },
  { id: 'cross-asset', module: '跨资产相关', title: '跨资产相关性', url: '/api/v1/analysis/cross-asset-correlation.json', link: '/analysis/cross-asset' },
  { id: 'credit-stress', module: '信用压力', title: '信用压力监测', url: '/api/v1/analysis/credit-stress.json', link: '/analysis/credit-stress' },
  { id: 'liquidity', module: '全球流动性', title: '全球净流动性', url: '/api/v1/global-liquidity.json', link: '/indicators/global-liquidity' },
]

function dirFromSignal(direction: string | undefined): Dir {
  if (direction === 'bullish' || direction === 'risk_on' || direction === 'expansion' || direction === 'positive') return 1
  if (direction === 'bearish' || direction === 'risk_off' || direction === 'contraction' || direction === 'negative') return -1
  return 0
}

function safeJson<T = any>(
  url: string,
): Promise<{ ok: boolean; data: T | null; error?: string }> {
  return fetch(url)
    .then((r) => r.json())
    .then((j: any) =>
      j.success
        ? { ok: true, data: j.data as T }
        : { ok: false, data: null, error: j.error },
    )
    .catch((e: any) => ({ ok: false, data: null, error: e.message }))
}

/** Promise.allSettled 失败分支的兜底，需与 safeJson 返回结构一致以便类型收窄 */
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

      {/* 置信度 */}
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

      {/* 证据标签：用 Portal Tooltip，不再被祖先的 overflow 裁剪 */}
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

/* --------------------------------------------------------------------------- */

export function SignalBoardDashboard() {
  const [signals, setSignals] = useState<SignalInput[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [agg, setAgg] = useState<Aggregate | null>(null)
  const [snapshots, setSnapshots] = useState<BacktestSnapshot[] | null>(null)
  const [indexSeries, setIndexSeries] = useState<{ symbol: string; nameZh: string; data: (number | null)[] }[]>([])
  const [chartIndex, setChartIndex] = useState('^GSPC')
  const [tiles, setTiles] = useState<Tiles>({
    sp500: null,
    regimeLabel: null,
    regimeMonths: null,
    regimeConf: null,
    gold: null,
    dxy: null,
    netLiq: null,
    netLiqDelta: null,
    totalAnom: 0,
    highAnom: 0,
  })

  const load = () => {
    let alive = true
    setLoading(true)
    setError('')
    Promise.allSettled([
      safeJson<any>('/api/v1/regime.json'),
      safeJson<any>('/api/v1/regime/anomalies.json'),
      safeJson<any>('/api/v1/gold/correlation.json'),
      safeJson<any>('/api/v1/regime/backtest.json'),
      safeJson<any>('/api/v1/global-liquidity.json'),
      ...ANALYSIS_MODULES.slice(0, 5).map((c) => safeJson<any>(c.url)),
    ])
      .then((results) => {
        if (!alive) return
        const rows: SignalInput[] = []
        const tls: Tiles = {
          sp500: null,
          regimeLabel: null,
          regimeMonths: null,
          regimeConf: null,
          gold: null,
          dxy: null,
          netLiq: null,
          netLiqDelta: null,
          totalAnom: 0,
          highAnom: 0,
        }

        const regime =
          results[0].status === 'fulfilled' ? results[0].value : EMPTY_RESULT
        if (regime.ok && regime.data) {
          const r = regime.data
          tls.regimeLabel = r.label ?? null
          tls.regimeConf = r.confidence ?? null
          rows.push({
            id: 'regime',
            module: '宏观体制',
            title: `${r.label}（${r.regime}）`,
            direction: REGIME_DIR[r.regime] ?? 0,
            confidence: r.confidence,
            evidence: (r.signals || [])
              .slice(0, 6)
              .map(
                (s: any) =>
                  `${s.name}: ${s.value}（${s.score === 1 ? '利好' : s.score === -1 ? '利空' : '中性'}）`,
              ),
            link: '/signals/regime',
          })
        }

        const anom =
          results[1].status === 'fulfilled' ? results[1].value : EMPTY_RESULT
        if (anom.ok && anom.data) {
          const a = anom.data
          const high = a.highCount ?? 0
          tls.totalAnom = a.totalCount ?? 0
          tls.highAnom = high
          rows.push({
            id: 'anomalies',
            module: '风险异常',
            title: `${a.totalCount} 项异常告警（高/严重 ${high} 项）`,
            direction: high >= 2 ? -1 : 0,
            confidence: Math.min(80, (a.totalCount || 0) * 15),
            evidence: (a.anomalies || [])
              .slice(0, 5)
              .map((x: any) => `${x.title}: ${x.description}`),
            link: '/signals/regime#anomalies',
          })
        }

        const gold =
          results[2].status === 'fulfilled' ? results[2].value : EMPTY_RESULT
        if (gold.ok && gold.data) {
          const s = gold.data.signal
          tls.gold = gold.data.latest?.gold ?? null
          tls.dxy = gold.data.latest?.dxy ?? null
          rows.push({
            id: 'gold',
            module: '黄金',
            title: s.title,
            direction:
              s.direction === 'bullish' ? 1 : s.direction === 'bearish' ? -1 : 0,
            confidence: s.confidence ?? 50,
            evidence: (s.evidence || []).slice(0, 5),
            link: '/signals/gold',
          })
        }

        const backtestResult =
          results[3].status === 'fulfilled' ? results[3].value : EMPTY_RESULT
        if (backtestResult.ok && backtestResult.data) {
          const snaps: BacktestSnapshot[] = backtestResult.data.snapshots ?? []
          setSnapshots(snaps)
          setIndexSeries(backtestResult.data.indexSeries ?? [])
          const lastValid = [...snaps].reverse().find((s) => s.sp500Price > 0)
          tls.sp500 = lastValid ? lastValid.sp500Price : null
          const segs = regimeSegments(snaps)
          const lastSeg = segs[segs.length - 1]
          if (lastSeg) {
            tls.regimeMonths = snaps.filter(
              (s) => s.date >= lastSeg.from && s.date <= lastSeg.to,
            ).length
          }
        }

        const liq =
          results[4].status === 'fulfilled' ? results[4].value : EMPTY_RESULT
        if (liq.ok && liq.data) {
          const nl: { date: string; value: number }[] = liq.data.netLiquidity ?? []
          if (nl.length >= 2) {
            const last = nl[nl.length - 1].value
            const prev = nl[Math.max(0, nl.length - 7)].value
            tls.netLiq = +(last / 1e6).toFixed(4)
            tls.netLiqDelta = +((last - prev) / 1e6).toFixed(4)
            const delta = tls.netLiqDelta
            rows.push({
              id: 'liquidity',
              module: '全球流动性',
              title: ANALYSIS_MODULES[5].title,
              direction: delta > 0 ? 1 : delta < 0 ? -1 : 0,
              confidence: 55,
              evidence: [
                `美联储净流动性 ${fmtTrillions(tls.netLiq)}`,
                `较 6 个月前 ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}T`,
              ],
              link: ANALYSIS_MODULES[5].link,
            })
          }
        }

        ANALYSIS_MODULES.slice(0, 5).forEach((cfg, i) => {
          const r = results[5 + i]
          const res = r.status === 'fulfilled' ? r.value : EMPTY_RESULT
          if (!res.ok || !res.data?.signal) return
          const sig = res.data.signal
          rows.push({
            id: cfg.id,
            module: cfg.module,
            title: cfg.title,
            direction: dirFromSignal(sig.direction),
            confidence: Math.round(sig.confidence ?? 50),
            evidence: Array.isArray(sig.evidence) ? sig.evidence.slice(0, 3).map(String) : [],
            link: cfg.link,
          })
        })

        const active = rows.filter((r) => r.direction !== 0)
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

        setSignals(rows)
        setTiles(tls)
        setAgg({ score: sN, label, stance, count: active.length })
      })
      .catch((e: any) => alive && setError(e.message || '加载失败'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }

  useEffect(load, [])

  const t = useChartTheme()
  const segments = useMemo(() => regimeSegments(snapshots), [snapshots])
  const currentSeries = indexSeries.find((i) => i.symbol === chartIndex) ?? indexSeries[0] ?? null
  const sp500Option = useMemo<EChartsOption | null>(() => {
    const override = currentSeries
      ? { name: currentSeries.nameZh, data: currentSeries.data }
      : null
    return buildSp500RegimeOption(t, snapshots, segments, override)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots, segments, t, currentSeries])

  if (loading) return <LoadingSkeleton type="card" rows={3} height={220} />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!agg || signals.length === 0)
    return (
      <EmptyState title="暂无信号" description="各模块数据同步后将在此汇总展示。" />
    )

  const gaugePercent = Math.min(95, Math.max(5, (agg.score + 100) / 2))
  const scoreTone =
    agg.score >= 15 ? 'text-up' : agg.score <= -15 ? 'text-down' : 'text-ink-2'

  return (
    <div className="flex flex-col gap-4">
      {/* 综合评分 */}
      <MacroCard variant="elevated">
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
      </MacroCard>

      {/* 今日市场速览 */}
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label="S&P500 最新"
          value={tiles.sp500 != null ? `$${tiles.sp500.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '--'}
          sub={tiles.regimeLabel && tiles.regimeMonths != null ? `${tiles.regimeLabel} · ${tiles.regimeMonths} 月` : tiles.regimeLabel ?? undefined}
          accent="blue"
        />
        <StatTile label="金价" value={fmt(tiles.gold)} sub="美元 / 盎司" accent="gold" />
        <StatTile label="美元指数" value={fmt(tiles.dxy)} sub="DXY" accent="none" />
        <StatTile
          label="净流动性"
          value={fmtTrillions(tiles.netLiq)}
          sub={tiles.netLiqDelta != null ? `${tiles.netLiqDelta >= 0 ? '+' : ''}${tiles.netLiqDelta.toFixed(2)}T / 6月` : undefined}
          accent="cyan"
          tone={tiles.netLiqDelta != null && tiles.netLiqDelta < 0 ? 'down' : 'neutral'}
        />
        <StatTile
          label="风险异常"
          value={`${tiles.highAnom} / ${tiles.totalAnom}`}
          sub="高/严重 / 总数"
          accent={tiles.highAnom > 0 ? 'red' : 'green'}
        />
        <StatTile
          label="体制置信度"
          value={tiles.regimeConf != null ? `${tiles.regimeConf}%` : '--'}
          sub={tiles.regimeLabel ?? undefined}
          accent={tiles.regimeConf != null && tiles.regimeConf > 60 ? 'green' : 'gold'}
        />
      </div>

      {/* 指数走势 × 宏观体制 */}
      {sp500Option && (
        <MacroCard
          title={`${currentSeries?.nameZh ?? 'S&P500'}走势与宏观体制`}
          padding="sm"
          badge={
            indexSeries.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {indexSeries.map((idx) => (
                  <button
                    key={idx.symbol}
                    type="button"
                    onClick={() => setChartIndex(idx.symbol)}
                    className={`rounded-sm border px-2 py-0.5 text-2xs transition-colors duration-1 ease-terminal ${
                      chartIndex === idx.symbol
                        ? 'border-accent bg-accent/15 text-ink'
                        : 'border-line bg-surface-2 text-ink-3 hover:text-ink-2'
                    }`}
                  >
                    {idx.nameZh.replace('指数', '')}
                  </button>
                ))}
              </div>
            ) : undefined
          }
        >
          <ResponsiveChartBox option={sp500Option} deps={[sp500Option]} />
          <RegimeLegend />
        </MacroCard>
      )}

      {/* 各模块信号 */}
      <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {signals.map((s) => (
          <SignalCard key={s.id} s={s} />
        ))}
      </div>

      <p className="text-xs leading-relaxed text-ink-3">
        组合信号板为多模块信号加权研究工具：权重 = 各信号置信度（黄金定价残差、宏观体制、风险异常、宏观共识、收益率曲线、通胀锚定、跨资产相关性、信用压力、全球流动性）。所有结论均附证据链，仅供研究参考，不构成投资建议。
      </p>
    </div>
  )
}
