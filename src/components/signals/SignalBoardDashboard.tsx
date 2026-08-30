import { useEffect, useState } from 'react'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'
import { ErrorState, EmptyState } from '../ui/States'
import { MacroCard } from '../ui/MacroCard'
import { Tooltip } from '../ui/Tooltip'

type Dir = -1 | 0 | 1

interface SignalInput {
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

  const load = () => {
    let alive = true
    setLoading(true)
    setError('')
    Promise.allSettled([
      safeJson<any>('/api/v1/regime.json'),
      safeJson<any>('/api/v1/regime/anomalies.json'),
      safeJson<any>('/api/v1/gold/correlation.json'),
    ])
      .then((results) => {
        if (!alive) return
        const rows: SignalInput[] = []

        const regime =
          results[0].status === 'fulfilled' ? results[0].value : EMPTY_RESULT
        if (regime.ok && regime.data) {
          const r = regime.data
          const REGIME_DIR: Record<string, Dir> = {
            GOLDILOCKS: 1,
            RISK_ON: 1,
            RECOVERY: 1,
            OVERHEAT: 0,
            STAGFLATION: -1,
            RISK_OFF: -1,
            UNKNOWN: 0,
          }
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
            link: '/signal-board',
          })
        }

        const anom =
          results[1].status === 'fulfilled' ? results[1].value : EMPTY_RESULT
        if (anom.ok && anom.data) {
          const a = anom.data
          const high = a.highCount ?? 0
          rows.push({
            id: 'anomalies',
            module: '风险异常',
            title: `${a.totalCount} 项异常告警（高/严重 ${high} 项）`,
            direction: high >= 2 ? -1 : 0,
            confidence: Math.min(80, (a.totalCount || 0) * 15),
            evidence: (a.anomalies || [])
              .slice(0, 5)
              .map((x: any) => `${x.title}: ${x.description}`),
            link: '/signal-board',
          })
        }

        const gold =
          results[2].status === 'fulfilled' ? results[2].value : EMPTY_RESULT
        if (gold.ok && gold.data) {
          const s = gold.data.signal
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
        setAgg({ score: sN, label, stance, count: active.length })
      })
      .catch((e: any) => alive && setError(e.message || '加载失败'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }

  useEffect(load, [])

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

      {/* 各模块信号 */}
      <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {signals.map((s) => (
          <SignalCard key={s.id} s={s} />
        ))}
      </div>

      <p className="text-xs leading-relaxed text-ink-3">
        组合信号板为多模块信号加权研究工具：权重 = 各信号置信度（黄金定价残差、宏观体制、风险异常）。所有结论均附证据链与历史验证，仅供研究参考，不构成投资建议。
      </p>
    </div>
  )
}
