import { useEffect, useState } from 'react'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'

type Dir = -1 | 0 | 1

interface SignalInput {
  id: string
  module: string
  title: string
  direction: Dir
  confidence: number // 0-100
  evidence: string[]
  link?: string
}

interface Aggregate {
  score: number // -100 ~ +100, >0 风险偏好
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
      safeJson<any>('/api/v1/etf-flow/event-study.json'),
      safeJson<any>('/api/v1/bonds/cn-us-spread.json'),
    ]).then(results => {
      if (!alive) return
      const rows: SignalInput[] = []

      // ── 1. 宏观体制 ──
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

      // ── 2. 风险异常 ──
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

      // ── 3. 黄金决策 ──
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

      // ── 4. 国家队资金流 ──
      const etf = results[3].status === 'fulfilled' ? results[3].value : { ok: false }
      if (etf.ok && etf.data && etf.data.ready) {
        const l = etf.data.latest
        let dir: Dir = 0
        let conf = 50
        const ev: string[] = []
        if (l.z >= 2) {
          dir = 1
          conf = Math.min(90, 55 + l.z * 8)
          const h = etf.data.groups?.find((g: any) => g.key === 'buy')
          ev.push(`宽基净申赎率 z=${l.z.toFixed(2)}（分位 ${l.percentile.toFixed(0)}），显著大额净申购`)
          if (h) ev.push(`历史：大额净申购后 20 日沪深300 中位数 ${(h.median * 100).toFixed(1)}%，胜率 ${(h.winRate * 100).toFixed(0)}%（${h.n} 次）`)
        } else if (l.z <= -2) {
          dir = -1
          conf = Math.min(90, 55 + Math.abs(l.z) * 8)
          const h = etf.data.groups?.find((g: any) => g.key === 'sell')
          ev.push(`宽基净申赎率 z=${l.z.toFixed(2)}（分位 ${l.percentile.toFixed(0)}），显著大额净赎回`)
          if (h) ev.push(`历史：大额净赎回后 20 日沪深300 中位数 ${(h.median * 100).toFixed(1)}%，胜率 ${(h.winRate * 100).toFixed(0)}%（${h.n} 次）`)
        } else {
          ev.push(`宽基净申赎率处于常态（z=${l.z.toFixed(2)}，分位 ${l.percentile.toFixed(0)}）`)
          ev.push('跟踪主要宽基 ETF 份额与「净申赎/成交额」比率：放量申购是底部区域、持续净赎回是高位减持的经典信号')
        }
        rows.push({ id: 'etf-flow', module: '国家队资金', title: '宽基 ETF 资金流向', direction: dir, confidence: conf, evidence: ev, link: '/tracking/etf-flow' })
      }

      // ── 5. 中美利差 ──
      const spread = results[4].status === 'fulfilled' ? results[4].value : { ok: false }
      if (spread.ok && spread.data) {
        const l = spread.data.latest
        const sp = l?.spread != null ? l.spread : null
        if (sp != null) {
          const invCount = spread.data.inversionCount ?? 0
          rows.push({
            id: 'spread', module: '中美利差', title: `10Y 中美国债利差 ${(sp * 100).toFixed(0)}bp`,
            direction: sp < -1 ? -1 : sp < -0.5 ? 0 : 1,
            confidence: Math.min(70, Math.abs(sp) * 25 + 20),
            evidence: [
              `当前 ${(sp * 100).toFixed(0)}bp（5Y 分位 ${spread.data.percentile5y ?? '--'}），历史倒挂 ${invCount} 次`,
              '深度负利差通常伴随美债高收益率虹吸与人民币资产承压',
            ],
          })
        }
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

  return (
    <div>
      {agg && (
        <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 20, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 30, fontWeight: 800, color: agg.score >= 15 ? 'var(--green)' : agg.score <= -15 ? 'var(--red)' : 'var(--text-secondary)' }}>
              {agg.score >= 0 ? '+' : ''}{agg.score}
            </span>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{agg.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{agg.count} 路实体信号加权 · 权重 = 信号置信度</div>
            </div>
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--text-primary)' }}>今日推演：</strong>{agg.stance}
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              <span>防守 ←</span><span>风险偏好</span><span>← 进攻</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-card-hover, rgba(255,255,255,0.06))', position: 'relative' }}>
              <div style={{
                position: 'absolute', left: '50%', top: -3, width: 2, height: 14, background: 'var(--text-muted)',
              }} />
              <div style={{
                position: 'absolute', left: `${Math.min(95, Math.max(5, (agg.score + 100) / 2))}%`, top: -5,
                width: 16, height: 16, borderRadius: '50%',
                background: agg.score >= 15 ? 'var(--green)' : agg.score <= -15 ? 'var(--red)' : 'var(--accent-blue)',
                transform: 'translateX(-50%)', boxShadow: '0 0 8px rgba(0,0,0,0.3)',
              }} />
            </div>
          </div>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
        {signals.map(s => {
          const dirColor = s.direction === 1 ? 'var(--green)' : s.direction === -1 ? 'var(--red)' : 'var(--text-muted)'
          const dirLabel = s.direction === 1 ? '偏多' : s.direction === -1 ? '偏空' : '中性'
          return (
            <section key={s.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.module}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{s.title}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: dirColor }}>{dirLabel}</span>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>置信度 {s.confidence}% · 权重 {Math.max(s.confidence, 10) / (allW || 1) * 100 | 0}%</div>
                </div>
              </div>
              <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                {s.evidence.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
              {s.link && (
                <div style={{ marginTop: 10 }}>
                  <a href={s.link} style={{ fontSize: 12, color: 'var(--accent-cyan)' }}>查看模块详情 →</a>
                </div>
              )}
            </section>
          )
        })}
      </div>

      <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>
        组合信号板为多模块信号加权研究工具：权重=各信号置信度（黄金定价残差、宏观体制、风险异常、宽基资金流、中美利差）。所有结论均附证据链与历史验证，仅供研究参考，不构成投资建议。
      </div>
    </div>
  )
}
