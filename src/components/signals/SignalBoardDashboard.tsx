import { useEffect, useState } from 'react'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'

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

function safeJson<T = any>(url: string): Promise<{ ok: boolean; data: T | null; error?: string }> {
  return fetch(url)
    .then(r => r.json())
    .then((j: any) => j.success ? { ok: true, data: j.data as T } : { ok: false, data: null, error: j.error })
    .catch((e: any) => ({ ok: false, data: null, error: e.message }))
}

function getAccentDir(dir: Dir): 'green' | 'red' | 'none' {
  if (dir === 1) return 'green'
  if (dir === -1) return 'red'
  return 'none'
}

export function SignalBoardDashboard() {
  const [signals, setSignals] = useState<SignalInput[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [agg, setAgg] = useState<Aggregate | null>(null)

  useEffect(() => {
    let alive = true
    Promise.allSettled([
      safeJson<any>('/api/v1/regime.json'),
      safeJson<any>('/api/v1/regime/anomalies.json'),
      safeJson<any>('/api/v1/gold/correlation.json'),
    ]).then(results => {
      if (!alive) return
      const rows: SignalInput[] = []

      const regime = results[0].status === 'fulfilled' ? results[0].value : { ok: false }
      if (regime.ok && regime.data) {
        const r = regime.data
        const REGIME_DIR: Record<string, Dir> = {
          GOLDILOCKS: 1, RISK_ON: 1, RECOVERY: 1, OVERHEAT: 0,
          STAGFLATION: -1, RISK_OFF: -1, UNKNOWN: 0,
        }
        const dir = REGIME_DIR[r.regime] ?? 0
        rows.push({
          id: 'regime', module: '宏观体制', title: `${r.label}（${r.regime}）`,
          direction: dir,
          confidence: r.confidence,
          evidence: (r.signals || []).slice(0, 6).map((s: any) => `${s.name}: ${s.value}（${s.score === 1 ? '利好' : s.score === -1 ? '利空' : '中性'}）`),
          link: '/signal-board',
        })
      }

      const anom = results[1].status === 'fulfilled' ? results[1].value : { ok: false }
      if (anom.ok && anom.data) {
        const a = anom.data
        const high = a.highCount ?? 0
        rows.push({
          id: 'anomalies', module: '风险异常', title: `${a.totalCount} 项异常告警（高/严重 ${high} 项）`,
          direction: high >= 2 ? -1 : high === 1 ? 0 : 0,
          confidence: Math.min(80, (a.totalCount || 0) * 15),
          evidence: (a.anomalies || []).slice(0, 5).map((x: any) => `${x.title}: ${x.description}`),
          link: '/signal-board',
        })
      }

      const gold = results[2].status === 'fulfilled' ? results[2].value : { ok: false }
      if (gold.ok && gold.data) {
        const s = gold.data.signal
        rows.push({
          id: 'gold', module: '黄金', title: s.title,
          direction: s.direction === 'bullish' ? 1 : s.direction === 'bearish' ? -1 : 0,
          confidence: s.confidence ?? 50,
          evidence: (s.evidence || []).slice(0, 5),
          link: '/signals/gold',
        })
      }

      const active = rows.filter(r => r.direction !== 0)
      const totalW = active.reduce((s, r) => s + r.confidence, 0)
      const score = totalW > 0 ? active.reduce((s, r) => s + r.direction * r.confidence, 0) / totalW * 100 : 0
      const sN = Math.round(score)
      const label = sN >= 50 ? '显著风险偏好' : sN >= 15 ? '风险偏好偏强' : sN > -15 ? '中性震荡' : sN > -50 ? '谨慎防守' : '显著防守'
      let stance = ''
      if (sN >= 15) stance = '市场内部数据偏暖，风险资产（股票/商品）相对占优，增长与盈利预期未现逆转。'
      else if (sN > -15) stance = '信号多空交织，无一致方向，建议维持中性仓位并等待资金/价格确认。'
      else stance = '风险信号占据主导（异常告警 / 体制偏弱 / 金价高估等），优先控制回撤，保留现金与避险资产。'

      setSignals(rows)
      setAgg({ score: sN, label, stance, count: active.length })
    }).catch((e: any) => setError(e.message || '加载失败')).finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  if (loading) return <LoadingSkeleton type="chart" height={420} />
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{error}</div>

  const allW = signals.reduce((s, r) => s + Math.max(r.confidence, 10), 0)
  const gaugePercent = Math.min(95, Math.max(5, (agg!.score + 100) / 2))

  return (
    <div>
      {agg && (
        <section className="macro-card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 20, alignItems: 'center' }}>
            {/* 分数 */}
            <div style={{ textAlign: 'center', minWidth: 100 }}>
              <div
                className="signal-score"
                style={{
                  fontSize: 'var(--font-size-hero)',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  color: agg.score >= 15 ? 'var(--green)' : agg.score <= -15 ? 'var(--red)' : 'var(--text-secondary)',
                  lineHeight: 1,
                  textShadow: agg.score >= 15 ? '0 0 20px rgba(0,200,83,0.3)' : agg.score <= -15 ? '0 0 20px rgba(255,59,48,0.3)' : 'none',
                }}
              >
                {agg.score >= 0 ? '+' : ''}{agg.score}
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>
                {agg.label}
              </div>
            </div>

            {/* 状态描述 */}
            <div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
                {agg.count} 路实体信号加权 · 权重 = 信号置信度
              </div>
              <div style={{ fontSize: 'var(--font-size-base)', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>今日推演：</strong>{agg.stance}
              </div>
            </div>

            {/* 仪表盘 */}
            <div style={{ minWidth: 140 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
                <span>防守</span><span>风险偏好</span>
              </div>
              <div className="signal-gauge">
                <div className="signal-gauge__track" />
                <div
                  className="signal-gauge__pointer"
                  style={{ left: `${gaugePercent}%` }}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        {signals.map(s => {
          const dirColor = s.direction === 1 ? 'var(--green)' : s.direction === -1 ? 'var(--red)' : 'var(--text-muted)'
          const dirLabel = s.direction === 1 ? '偏多' : s.direction === -1 ? '偏空' : '中性'
          return (
            <section key={s.id} className={`macro-card macro-card--accent-${getAccentDir(s.direction)}`} style={{ padding: 'var(--space-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-2)' }}>
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>{s.module}</div>
                  <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginTop: 2, color: 'var(--text-primary)' }}>{s.title}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 'var(--space-2)' }}>
                  <span style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, color: dirColor, fontFamily: 'var(--font-mono)' }}>{dirLabel}</span>
                </div>
              </div>

              {/* 置信度进度条 */}
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 3 }}>
                  <span>置信度</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{s.confidence}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-bar__fill" style={{ width: `${s.confidence}%`, background: dirColor }} />
                </div>
              </div>

              {/* 证据标签 */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {s.evidence.slice(0, 3).map((e, i) => (
                  <span key={i} className="tag tag-sm" style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e}</span>
                ))}
              </div>

              {s.link && (
                <div style={{ marginTop: 'var(--space-2)' }}>
                  <a href={s.link} style={{ fontSize: 'var(--font-size-sm)', color: 'var(--accent-cyan)' }}>查看模块详情 →</a>
                </div>
              )}
            </section>
          )
        })}
      </div>

      <div style={{ marginTop: 'var(--space-4)', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', lineHeight: 1.8 }}>
        组合信号板为多模块信号加权研究工具：权重=各信号置信度（黄金定价残差、宏观体制、风险异常）。所有结论均附证据链与历史验证，仅供研究参考，不构成投资建议。
      </div>
    </div>
  )
}
