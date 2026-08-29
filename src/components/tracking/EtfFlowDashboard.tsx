import { useEffect, useMemo, useState } from 'react'
import echarts from '../../lib/echarts'
import { useChart } from '../charts/useChart'
import { useChartTheme } from '../ui/theme'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'

interface ListItem {
  code: string
  name: string
  exchange: string
  track_index: string
  category: string
  close: number | null
  changePct: number | null
  amount: number | null
  shares: number | null
  sharesChange1d: number | null
  net1d: number | null
  sharesChange5d: number | null
  sharesChange20d: number | null
}

interface BoardData {
  updatedAt: string
  aggregate: { date: string; amount: number | null; net: number | null; ratio: number | null }[]
  weeks: { weekStart: string; days: number; totalAmount: number | null; totalNet: number | null; ratio: number | null }[]
  etfList: ListItem[]
  dailyTable: { date: string; code: string; name: string; category: string; changePct: number | null; amount: number | null; net: number | null; ratio: number | null }[]
}

interface DetailData {
  code: string
  name: string
  exchange: string
  track_index: string
  category: string
  price: { date: string; close: number | null; amount: number | null }[]
  shares: { date: string; shares: number | null }[]
  netFlow: { date: string; net: number | null }[]
}

interface StudyRow {
  date: string
  rets: Record<string, number | null>
}
interface StudyResult {
  nEvents: number
  horizons: Record<string, { n: number; mean: number; median: number; winRate: number; p25: number; p75: number }>
}

interface EventsData {
  ready: boolean
  latest?: {
    date: string
    ratio: number
    z: number
    percentile: number
    netYi: number | null
    amountYi: number | null
  }
  events?: { buy: StudyResult; sell: StudyResult }
  groups?: { group: string; key: string; n: number; median: number; mean: number; winRate: number }[]
  lags?: { k: number; corr: number }[]
  series?: {
    ratio: { date: string; value: number }[]
    netYi: { date: string; value: number }[]
    csi300: { date: string; value: number }[]
  }
}

const fmtPct = (v: number | null | undefined, d = 1) => (v == null ? '--' : `${(v * 100).toFixed(d)}%`)
const fmtNum = (v: number | null | undefined, d = 2) => (v == null ? '--' : Number(v).toFixed(d))
const isUp = (v: number | null | undefined) => v != null && v > 0

function Chart({ option, height = 260 }: { option: any | null; height?: number }) {
  const { ref } = useChart(option, [option])
  return (
    <div style={{ width: '100%', height, position: 'relative' }}>
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'left', padding: '5px 6px', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600, borderBottom: '1px solid var(--border-light)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { textAlign: 'left', padding: '5px 6px', borderBottom: '1px solid var(--border-light)', color: 'var(--text-secondary)', fontSize: 11, whiteSpace: 'nowrap' }

function StudyTable({ title, study, color }: { title: string; study: StudyResult; color?: string }) {
  if (!study || study.nEvents === 0) return null
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: color || 'var(--text-secondary)', marginBottom: 4 }}>{title} · {study.nEvents} 个事件</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr><th style={th}>窗口</th><th style={th}>样本</th><th style={th}>胜率</th><th style={th}>中位数</th><th style={th}>均值</th><th style={th}>P25</th><th style={th}>P75</th></tr>
        </thead>
        <tbody>
          {Object.entries(study.horizons).map(([h, s]) => (
            <tr key={h}>
              <td style={td}>{h} 日</td>
              <td style={td}>{s.n}</td>
              <td style={{ ...td, color: s.winRate >= 0.5 ? 'var(--green)' : 'var(--red)' }}>{fmtPct(s.winRate)}</td>
              <td style={{ ...td, color: s.median >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtPct(s.median)}</td>
              <td style={td}>{fmtPct(s.mean)}</td>
              <td style={td}>{fmtPct(s.p25)}</td>
              <td style={td}>{fmtPct(s.p75)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function EtfFlowDashboard() {
  const [board, setBoard] = useState<BoardData | null>(null)
  const [detail, setDetail] = useState<DetailData | null>(null)
  const [events, setEvents] = useState<EventsData | null>(null)
  const [selected, setSelected] = useState('510300')
  const [tab, setTab] = useState<'flow' | 'study'>('flow')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const t = useChartTheme()

  useEffect(() => {
    let alive = true
    Promise.all([
      fetch('/api/v1/etf-flow.json').then(r => r.json()),
      fetch('/api/v1/etf-flow/event-study.json').then(r => r.json()),
    ])
      .then(([b, e]) => {
        if (!alive) return
        setBoard(b.success ? b.data : null)
        if (!b.success) setError(b.error || '加载失败')
        setEvents(e.success ? e.data : null)
      })
      .catch((e: any) => alive && setError(e.message || '加载失败'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!selected) return
    let alive = true
    setDetail(null)
    fetch(`/api/v1/etf-flow.json?detail=${selected}`)
      .then(r => r.json())
      .then(j => alive && j.success && setDetail(j.data))
      .catch(() => {})
    return () => { alive = false }
  }, [selected])

  const fourChart = useMemo(() => {
    if (!detail || detail.price.length === 0) return null
    const dates = detail.price.map(p => p.date)
    const closeSeries = detail.price.map(p => p.close)
    const amountSeries = detail.price.map(p => p.amount)
    const shareMap = new Map(detail.shares.map(s => [s.date, s.shares]))
    const shareSeries = dates.map(d => shareMap.get(d) ?? null)
    const flowMap = new Map(detail.netFlow.map(f => [f.date, f.net]))
    const flowSeries = dates.map(d => flowMap.get(d) ?? null)
    const y0 = Math.min(...shareSeries.filter((v): v is number => v != null))
    const y1 = Math.max(...shareSeries.filter((v): v is number => v != null))

    const axis = (): any => ({
      type: 'category', data: dates, axisLabel: { color: t.textMuted, fontSize: 10 }, axisLine: { lineStyle: { color: t.borderColor } },
    })

    return {
      price: {
        tooltip: { trigger: 'axis', backgroundColor: t.bgCard, borderColor: t.borderLight, textStyle: { color: t.textPrimary }, valueFormatter: (v: any) => fmtNum(v) },
        grid: { left: 46, right: 56, top: 24, bottom: 24 },
        xAxis: axis(),
        yAxis: [
          { type: 'value', scale: true, name: '价格', nameTextStyle: { color: t.textMuted }, axisLabel: { color: t.textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: t.borderColor, type: 'dashed' } } },
          { type: 'value', scale: true, name: '成交额(亿)', nameTextStyle: { color: t.textMuted }, axisLabel: { color: t.textMuted, fontSize: 10 }, splitLine: { show: false } },
        ],
        series: [
          { name: '收盘价', type: 'line', data: closeSeries, smooth: true, showSymbol: false, lineStyle: { width: 2, color: t.cyan }, areaStyle: { color: t.blueArea } },
          { name: '成交额(亿)', type: 'bar', yAxisIndex: 1, data: amountSeries, itemStyle: { color: 'rgba(59,130,246,0.35)' }, barMaxWidth: 3 },
        ],
      },
      share: {
        tooltip: { trigger: 'axis', backgroundColor: t.bgCard, borderColor: t.borderLight, textStyle: { color: t.textPrimary }, valueFormatter: (v: any) => `${fmtNum(v, 1)} 万份` },
        grid: { left: 70, right: 16, top: 24, bottom: 24 },
        xAxis: axis(),
        yAxis: { type: 'value', scale: true, min: y0 - (y1 - y0) * 0.15, axisLabel: { color: t.textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: t.borderColor, type: 'dashed' } } },
        series: [{ name: '基金份额(万份)', type: 'line', data: shareSeries, smooth: true, showSymbol: false, lineStyle: { width: 2, color: t.gold }, areaStyle: { color: t.goldDim } }],
      },
      flow: {
        tooltip: { trigger: 'axis', backgroundColor: t.bgCard, borderColor: t.borderLight, textStyle: { color: t.textPrimary }, valueFormatter: (v: any) => `${fmtNum(v)} 亿` },
        grid: { left: 46, right: 16, top: 24, bottom: 24 },
        xAxis: axis(),
        yAxis: { type: 'value', scale: true, axisLabel: { color: t.textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: t.borderColor, type: 'dashed' } } },
        series: [{
          name: '净申赎(亿)', type: 'bar',
          data: flowSeries.map(v => v == null ? null : {
            value: v,
            itemStyle: { color: v >= 0 ? 'rgba(242,54,69,0.65)' : 'rgba(8,153,129,0.65)' },
          }),
          barMaxWidth: 4,
        }],
      },
    }
  }, [detail, t])

  if (loading) return <LoadingSkeleton type="chart" height={520} />
  if (error || !board) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{error || '暂无数据（请先运行 sync 脚本 fetch_etf_flow 填充数据）'}</div>

  const lastAgg = board.aggregate[board.aggregate.length - 1]

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {([
          { k: 'flow' as const, label: '资金流向' },
          { k: 'study' as const, label: '资金 vs 未来涨跌' },
        ]).map(x => (
          <button
            key={x.k}
            onClick={() => setTab(x.k)}
            style={{
              padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: tab === x.k ? '1px solid var(--accent-blue)' : '1px solid var(--border-light)',
              background: tab === x.k ? 'var(--accent-blue-dim)' : 'var(--bg-card)',
              color: tab === x.k ? 'var(--accent-blue)' : 'var(--text-secondary)',
            }}
          >
            {x.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
          数据更新 {board.updatedAt} · 研究参考，非投资建议
        </div>
      </div>

      {tab === 'flow' && (
        <>
          {/* 汇总卡：最近 4 周 */}
          <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>宽基 ETF 汇总（近 4 周 · 净申赎/成交额）</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              {board.weeks.map((w, i) => (
                <div key={w.weekStart} style={{ background: 'var(--bg-card-hover, rgba(255,255,255,0.04))', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{w.weekStart} 起 · {w.days} 交易日</div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3 }}>
                    合计净额 <span style={{ color: (w.totalNet ?? 0) >= 0 ? 'var(--red)' : 'var(--green)' }}>{fmtNum(w.totalNet)} 亿</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    成交 {fmtNum(w.totalAmount)} 亿 · 净申赎率 {fmtPct(w.ratio, 2)}
                  </div>
                </div>
              ))}
            </div>
            {lastAgg && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 10 }}>
                {[
                  { l: '最新交易日', v: lastAgg.date, s: '' },
                  { l: '当日成交额', v: `${fmtNum(lastAgg.amount)} 亿`, s: '' },
                  { l: '当日净申赎', v: `${fmtNum(lastAgg.net)} 亿`, s: lastAgg.net != null ? (lastAgg.net >= 0 ? '资金流入' : '资金流出') : '' },
                  { l: '净申赎 / 成交额', v: fmtPct(lastAgg.ratio, 2), s: '国家队行为代理指标' },
                ].map(k => (
                  <div key={k.l} style={{ background: 'rgba(245,158,11,0.08)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{k.l}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2, color: 'var(--text-primary)' }}>{k.v}</div>
                    {k.s && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{k.s}</div>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr 320px', gap: 14, alignItems: 'start' }}>
            {/* 左：ETF 列表 */}
            <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 12, maxHeight: 760, overflowY: 'auto' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>ETF 列表（宽基 / 行业）</div>
              {board.etfList.map(item => (
                <div
                  key={item.code}
                  onClick={() => setSelected(item.code)}
                  style={{
                    padding: '8px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 4,
                    background: selected === item.code ? 'var(--accent-blue-dim)' : 'transparent',
                    border: selected === item.code ? '1px solid var(--accent-blue)' : '1px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{item.name}</span>
                    <span style={{ fontSize: 12, color: isUp(item.changePct) ? 'var(--red)' : 'var(--green)' }}>{fmtNum(item.changePct)}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, fontSize: 10, color: 'var(--text-muted)' }}>
                    <span>{item.code} · {item.amount != null ? `${fmtNum(item.amount)} 亿` : '--'}</span>
                    <span>20d 份额 <span style={{ color: isUp(item.sharesChange20d) ? 'var(--red)' : 'var(--green)' }}>{fmtPct(item.sharesChange20d, 2)}</span></span>
                  </div>
                </div>
              ))}
            </section>

            {/* 中：四联图 */}
            <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                {detail ? `${detail.name}（${detail.code} · ${detail.exchange} · ${detail.track_index || ''}）` : '加载中…'}
              </div>
              {detail && fourChart ? (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', margin: '4px 0' }}>日线价格走势①</div>
                  <Chart option={fourChart.price} height={190} />
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', margin: '10px 0 4px' }}>日线 ETF 份额走势②</div>
                  <Chart option={fourChart.share} height={150} />
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', margin: '10px 0 4px' }}>日线净申赎金额（分 · 亿）③</div>
                  <Chart option={fourChart.flow} height={150} />
                </>
              ) : (
                <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>份额数据回补中，稍后刷新可见</div>
              )}
            </section>

            {/* 右：明细表 */}
            <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 12, maxHeight: 760, overflowY: 'auto' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>按日明细（份额变动 / 成交额 / 净申赎 / 比率）</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>日期</th>
                    <th style={th}>名称</th>
                    <th style={th}>成交额亿</th>
                    <th style={th}>净申赎亿</th>
                    <th style={th}>净申赎/成交</th>
                  </tr>
                </thead>
                <tbody>
                  {board.dailyTable.map((r, i) => (
                    <tr key={i}>
                      <td style={td}>{r.date.slice(5)}</td>
                      <td style={{ ...td, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</td>
                      <td style={td}>{fmtNum(r.amount)}</td>
                      <td style={{ ...td, color: (r.net ?? 0) >= 0 ? 'var(--red)' : 'var(--green)' }}>{fmtNum(r.net)}</td>
                      <td style={{ ...td, color: (r.ratio ?? 0) >= 0.01 ? 'var(--red)' : 'var(--green)' }}>{fmtPct(r.ratio, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}

      {tab === 'study' && (
        <StudyPanel events={events} t={t} />
      )}

      <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>
        数据来源：上交所/深交所 ETF 基金份额（每日披露）+ 东财 ETF 行情，「净申赎金额」= 份额变化 × 收盘价，为机构（含中央汇金等）间接行为的日度高频代理指标。统计结果仅供研究参考，不构成投资建议。
      </div>
    </div>
  )
}

function StudyPanel({ events, t }: { events: EventsData | null; t: any }) {
  const [lagOption, setLagOption] = useState<any | null>(null)
  const [groupOption, setGroupOption] = useState<any | null>(null)
  const [ratioOption, setRatioOption] = useState<any | null>(null)

  useEffect(() => {
    if (!events?.series) return
    const s = events.series
    setRatioOption({
      tooltip: { trigger: 'axis', backgroundColor: t.bgCard, borderColor: t.borderLight, textStyle: { color: t.textPrimary } },
      legend: { data: ['净申赎率(%)', '沪深300', '净申赎(亿)'], textStyle: { color: t.textMuted, fontSize: 11 }, top: 0 },
      grid: { left: 46, right: 56, top: 26, bottom: 24 },
      xAxis: { type: 'category', data: s.ratio.map(p => p.date), axisLabel: { color: t.textMuted, fontSize: 10 }, axisLine: { lineStyle: { color: t.borderColor } } },
      yAxis: [
        { type: 'value', name: '%', nameTextStyle: { color: t.textMuted }, axisLabel: { color: t.textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: t.borderColor, type: 'dashed' } } },
        { type: 'value', name: '指数/亿', nameTextStyle: { color: t.textMuted }, axisLabel: { color: t.textMuted, fontSize: 10 }, splitLine: { show: false } },
      ],
      series: [
        { name: '净申赎率(%)', type: 'bar', data: s.ratio.map(p => +(p.value * 100).toFixed(2)), barMaxWidth: 3, itemStyle: { color: 'rgba(59,130,246,0.4)' } },
        { name: '沪深300', type: 'line', yAxisIndex: 1, data: s.csi300.map(p => p.value), smooth: true, showSymbol: false, lineStyle: { color: t.cyan, width: 2 } },
        { name: '净申赎(亿)', type: 'line', yAxisIndex: 1, data: s.netYi.map(p => p.value), smooth: true, showSymbol: false, lineStyle: { color: t.gold, width: 1.2, type: 'dashed' } },
      ],
    })
    if (events.lags && events.lags.length > 0) {
      setLagOption({
        tooltip: { trigger: 'axis', backgroundColor: t.bgCard, borderColor: t.borderLight, textStyle: { color: t.textPrimary }, valueFormatter: (v: any) => Number(v).toFixed(3) },
        grid: { left: 46, right: 16, top: 16, bottom: 24 },
        xAxis: { type: 'category', data: events.lags.map(l => `${l.k}日`), axisLabel: { color: t.textMuted, fontSize: 10 }, axisLine: { lineStyle: { color: t.borderColor } }, name: '资金流 → 未来收益滞后' },
        yAxis: { type: 'value', axisLabel: { color: t.textMuted, fontSize: 10 }, splitLine: { lineStyle: { color: t.borderColor, type: 'dashed' } } },
        series: [{
          name: '相关', type: 'bar',
          data: events.lags.map(l => ({
            value: +l.corr.toFixed(3),
            itemStyle: { color: l.corr >= 0 ? 'rgba(242,54,69,0.7)' : 'rgba(8,153,129,0.7)' },
          })),
        }],
      })
    }
    if (events.groups && events.groups.length > 0) {
      setGroupOption({
        tooltip: { trigger: 'axis', backgroundColor: t.bgCard, borderColor: t.borderLight, textStyle: { color: t.textPrimary }, valueFormatter: (v: any) => fmtPct(v) },
        grid: { left: 56, right: 16, top: 16, bottom: 24 },
        xAxis: { type: 'category', data: events.groups.map(g => g.group), axisLabel: { color: t.textMuted, fontSize: 11 }, axisLine: { lineStyle: { color: t.borderColor } } },
        yAxis: { type: 'value', axisLabel: { color: t.textMuted, fontSize: 10, formatter: (v: any) => `${(v * 100).toFixed(0)}%` }, splitLine: { lineStyle: { color: t.borderColor, type: 'dashed' } } },
        series: [{
          name: '20日后收益中位数', type: 'bar', barMaxWidth: 60,
          data: events.groups.map(g => ({ value: g.median, itemStyle: { color: g.median >= 0 ? 'var(--red)' : 'var(--green)' } })),
        }],
      })
    }
  }, [events, t])

  if (!events || !events.ready) {
    return (
      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        {events?.message || '数据积累中：需要至少 40 个交易日宽基资金流与沪深300数据后进行事件研究。请确认 sync 任务 fetch_etf_flow --full 已运行。'}
      </section>
    )
  }

  const latest = events.latest!

  return (
    <>
      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          {[
            { l: '交易日', v: latest.date },
            { l: '宽基净申赎率', v: fmtPct(latest.ratio, 2), s: `数据 5Y 分位 ${latest.percentile.toFixed(0)}` },
            { l: 'z-score', v: `${latest.z >= 0 ? '+' : ''}${latest.z.toFixed(2)}`, s: latest.z >= 2 ? '显著大额净申购' : latest.z <= -2 ? '显著大额净赎回' : '中性' },
            { l: '当日净申赎', v: `${fmtNum(latest.netYi)} 亿`, s: (latest.netYi ?? 0) >= 0 ? '流入' : '流出' },
            { l: '当日成交额', v: `${fmtNum(latest.amountYi)} 亿` },
          ].map(k => (
            <div key={k.l} style={{ background: 'var(--bg-card-hover, rgba(255,255,255,0.04))', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{k.l}</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{k.v}</div>
              {k.s && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{k.s}</div>}
            </div>
          ))}
        </div>
      </section>

      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>事件研究：大额净申购 / 净赎回后，沪深300 怎么走？</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <StudyTable title="大额净申购（净申赎率 z ≥ 2）后" study={events.events!.buy} color="var(--red)" />
          <StudyTable title="大额净赎回（净申赎率 z ≤ -2）后" study={events.events!.sell} color="var(--green)" />
        </div>
        {events.groups && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>分组对比：申赎率极端的当日之后 20 日收益（中位数）</div>
            {groupOption && <Chart option={groupOption} height={220} />}
          </div>
        )}
      </section>

      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>领先滞后分析：资金流与未来收益</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          横轴为滞后天数 k：栏高表示「当日净申赎率」与「k 日后沪深300 收益」的相关系数。峰值在 0 附近 → 同步指标；峰值在正值 k → 资金流领先市场。
        </div>
        {lagOption && <Chart option={lagOption} height={220} />}
      </section>

      <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>资金流 vs 沪深300（近 1 年）</div>
        {ratioOption && <Chart option={ratioOption} height={260} />}
      </section>
    </>
  )
}
