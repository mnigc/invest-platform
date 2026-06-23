import { useEffect, useMemo, useState } from 'react'
import { MacroCard } from './ui/MacroCard'
import { useChartTheme } from './ui/theme'
import { LoadingSkeleton } from './ui/LoadingSkeleton'
import { useChart } from './charts/useChart'

interface DxyInfo {
  current: number; change: number; changePercent: number; date: string
  percentile: { pct: number; window: string } | null
  momentum7d: number | null; momentum30d: number | null; momentum7dLabel: string
  stats: Record<string, { zScore: number; percentile: number; mean: number; std: number; min: number; max: number; dataPoints: number }>
  history: { date: string; value: number }[]
}

interface PairInfo {
  symbol: string; current: number | null; change: number | null; changePercent: number | null
  date: string; history: { date: string; value: number }[]
}

interface DxyComponent {
  symbol: string; name: string; weight: number; current: number | null
  changePercent: number | null; contribution: number; isInverse: boolean
}

interface ForexData {
  dxy: DxyInfo
  pairs: PairInfo[]
  dxyComponents: DxyComponent[]
  dxyGoldCorr: number
  dxySpxCorr: number
  goldPrice: number | null
  spxPrice: number | null
}

const PAIR_LABELS: Record<string, { name: string; flag: string; desc: string }> = {
  'EURUSD=X': { name: '欧元/美元', flag: '\u{1F1EA}\u{1F1FA}', desc: '欧元区 vs 美国' },
  'USDJPY=X': { name: '美元/日元', flag: '\u{1F1EF}\u{1F1F5}', desc: '套息交易风向标' },
  'GBPUSD=X': { name: '英镑/美元', flag: '\u{1F1EC}\u{1F1E7}', desc: '英国 vs 美国' },
  'USDCNH=X': { name: '美元/离岸人民币', flag: '\u{1F1E8}\u{1F1F3}', desc: '中美汇率与资本流动' },
  'USDCHF=X': { name: '美元/瑞郎', flag: '\u{1F1E8}\u{1F1ED}', desc: '避险货币对比' },
  'AUDUSD=X': { name: '澳元/美元', flag: '\u{1F1E6}\u{1F1FA}', desc: '商品货币与风险偏好' },
  'USDCAD=X': { name: '美元/加元', flag: '\u{1F1E8}\u{1F1E6}', desc: '加拿大能源出口' },
  'NZDUSD=X': { name: '纽元/美元', flag: '\u{1F1F3}\u{1F1FF}', desc: '大洋洲商品货币' },
}

function MiniCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
        <span style={{ fontSize: '12px' }}>{icon}</span>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function HeroRow({ data }: { data: ForexData }) {
  const chartTheme = useChartTheme()
  const { dxy } = data
  const changeUp = dxy.change >= 0

  return (
    <div class="forex-grid-4-hero">
      <MiniCard icon="$" title="美元指数 (DXY)">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '30px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: chartTheme.textPrimary }}>
            {dxy.current.toFixed(2)}
          </span>
          <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: changeUp ? chartTheme.green : chartTheme.red }}>
            {changeUp ? '+' : ''}{dxy.change.toFixed(2)} ({dxy.changePercent >= 0 ? '+' : ''}{dxy.changePercent.toFixed(2)}%)
          </span>
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>{dxy.date}</div>
      </MiniCard>

      <MiniCard icon="%" title={`历史分位 ${dxy.percentile?.window || ''}`}>
        <div style={{ fontSize: '30px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: chartTheme.blue }}>
          {dxy.percentile != null ? `${dxy.percentile.pct.toFixed(1)}%` : '--'}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {dxy.percentile != null
            ? (dxy.percentile.pct < 25 ? '历史低位区间' : dxy.percentile.pct < 50 ? '低于平均' : dxy.percentile.pct < 75 ? '高于平均' : '历史高位区间')
            : '暂无数据'}
        </div>
      </MiniCard>

      <MiniCard icon="7" title="日动能">
        <div style={{ fontSize: '28px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: dxy.momentum7d != null ? (dxy.momentum7d < 0 ? chartTheme.red : chartTheme.green) : chartTheme.textMuted }}>
          {dxy.momentum7d != null ? `${dxy.momentum7d > 0 ? '+' : ''}${dxy.momentum7d.toFixed(2)}` : '--'}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {dxy.momentum7dLabel}
        </div>
      </MiniCard>

      <MiniCard icon="30" title="日动能">
        <div style={{ fontSize: '28px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: dxy.momentum30d != null ? (dxy.momentum30d < 0 ? chartTheme.red : chartTheme.green) : chartTheme.textMuted }}>
          {dxy.momentum30d != null ? `${dxy.momentum30d > 0 ? '+' : ''}${dxy.momentum30d.toFixed(2)}` : '--'}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {dxy.momentum30d != null ? (Math.abs(dxy.momentum30d) > 3 ? '趋势行情' : '区间震荡') : '暂无数据'}
        </div>
      </MiniCard>
    </div>
  )
}

function TrendChart({ history, title, color, yFormatter }: {
  history: { date: string; value: number }[]
  title: string
  color: string
  yFormatter?: (v: number) => string
}) {
  const chartTheme = useChartTheme()
  const { ref } = useChart(
    useMemo(() => {
      if (!history.length) return null
      const dates = history.map(p => p.date)
      const values = history.map(p => p.value)

      return {
        tooltip: {
          trigger: 'axis', backgroundColor: chartTheme.bgElevated, borderColor: chartTheme.borderLight,
          borderWidth: 1, textStyle: { color: chartTheme.textPrimary, fontSize: 12 },
          formatter: (params: any) => {
            const p = params[0]
            if (!p) return ''
            const val = yFormatter ? yFormatter(p.value) : Number(p.value).toFixed(2)
            return `<div style="font-size:11px;color:${chartTheme.textSecondary};margin-bottom:4px">${p.axisValue}</div>${title}: <strong style="color:${color}">${val}</strong>`
          },
        },
        grid: { left: 60, right: 20, top: 16, bottom: 50 },
        xAxis: {
          type: 'category', data: dates, axisLabel: { color: chartTheme.textMuted, fontSize: 9, showMaxLabel: true },
          axisLine: { lineStyle: { color: chartTheme.borderLight } }, axisTick: { show: false },
        },
        yAxis: {
          type: 'value', scale: true,
          axisLabel: { color: chartTheme.textMuted, fontSize: 10, formatter: (v: any) => yFormatter ? yFormatter(Number(v)) : Number(v).toFixed(1) },
          splitLine: { lineStyle: { color: chartTheme.borderColor, type: 'dashed' } },
          axisLine: { show: false },
        },
        dataZoom: [{ type: 'slider', start: 0, end: 100, height: 16, bottom: 4, borderColor: chartTheme.borderLight, backgroundColor: chartTheme.bgCard, fillerColor: chartTheme.blueDim, textStyle: { color: chartTheme.textMuted } }],
        series: [{
          type: 'line', name: title, data: values, smooth: true, showSymbol: false,
          lineStyle: { width: 2.5, color },
          areaStyle: { color: chartTheme.blueArea },
        }],
      } as any
    }, [history, chartTheme, title, color, yFormatter]),
    [history, chartTheme, color],
  )

  if (!history.length) return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>暂无数据</div>
  return (
    <div style={{ width: '100%', padding: '8px 0' }}>
      <div ref={ref} style={{ width: '100%', height: '380px' }} />
    </div>
  )
}

function PairCard({ pair }: { pair: PairInfo }) {
  const chartTheme = useChartTheme()
  const labels = PAIR_LABELS[pair.symbol] || { name: pair.symbol, flag: '$', desc: '' }
  const changeUp = (pair.changePercent || 0) >= 0

  return (
    <div style={{
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '4px', minHeight: '110px',
      borderRight: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '14px' }}>{labels.flag}</span>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>{labels.name}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <span style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: chartTheme.textPrimary }}>
          {pair.current != null ? pair.current.toFixed(4) : '--'}
        </span>
        <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: changeUp ? chartTheme.green : chartTheme.red }}>
          {pair.changePercent != null ? `${changeUp ? '+' : ''}${pair.changePercent.toFixed(2)}%` : '--'}
        </span>
      </div>
      <SparklineInline history={pair.history} changeUp={changeUp} />
    </div>
  )
}

function SparklineInline({ history, changeUp }: { history: { date: string; value: number }[]; changeUp: boolean }) {
  const chartTheme = useChartTheme()
  const { ref } = useChart(
    useMemo(() => {
      if (!history.length) return null
      // 当数据点 < 2 时补一个同值点形成水平线（例如仅今日数据）
      const rawValues = history.map(p => p.value)
      const values = rawValues.length >= 2 ? rawValues : [rawValues[0], rawValues[0]]
      const color = changeUp ? chartTheme.green : chartTheme.red
      return {
        grid: { left: 0, right: 0, top: 0, bottom: 0 },
        xAxis: { type: 'category', data: values.map(() => ''), show: false },
        yAxis: { type: 'value', show: false, min: Math.min(...values) * 0.998, max: Math.max(...values) * 1.002 },
        series: [{
          type: 'line', data: values, smooth: 0.3, showSymbol: false,
          lineStyle: { width: 1.5, color, opacity: values.length >= 2 ? 1 : 0.6 },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: color + '30' },
                { offset: 1, color: 'transparent' },
              ],
            },
            opacity: values.length >= 2 ? 1 : 0.4,
          },
        }],
      } as any
    }, [history, changeUp, chartTheme]),
    [history, changeUp, chartTheme],
  )

  if (!history.length) return null
  return <div ref={ref} style={{ width: '100%', height: '32px', marginTop: '2px' }} />
}

function PairsGrid({ pairs }: { pairs: PairInfo[] }) {
  return (
    <div class="forex-grid-4-pairs">
      {pairs.map(pair => (
        <PairCard key={pair.symbol} pair={pair} />
      ))}
    </div>
  )
}

function DxyComposition({ components }: { components: DxyComponent[] }) {
  const chartTheme = useChartTheme()
  const totalContribution = components.reduce((s, c) => s + c.contribution, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
      {components.map(comp => {
        const barWidth = Math.min(Math.abs(comp.contribution) * 3, 100)
        const contributionColor = comp.contribution >= 0 ? chartTheme.green : chartTheme.red
        return (
          <div key={comp.symbol} style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <div style={{ width: '60px', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'right', flexShrink: 0 }}>
              {comp.name}
            </div>
            <div style={{ width: '40px', fontSize: '10px', color: 'var(--text-muted)', textAlign: 'right', flexShrink: 0 }}>
              {comp.weight}%
            </div>
            <div style={{ flex: 1, height: '20px', background: 'var(--bg-card)', borderRadius: '4px', overflow: 'hidden', position: 'relative', minWidth: 0 }}>
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: 'var(--border-light)' }} />
              <div style={{
                position: 'absolute',
                left: comp.contribution >= 0 ? '50%' : `${50 - barWidth}%`,
                top: '2px', bottom: '2px',
                width: `${barWidth}%`,
                background: contributionColor,
                borderRadius: '3px',
                opacity: 0.7,
                transition: 'all 0.3s ease',
              }} />
            </div>
            <div style={{ width: '60px', fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: contributionColor, textAlign: 'right', flexShrink: 0 }}>
              {comp.contribution >= 0 ? '+' : ''}{comp.contribution.toFixed(2)}%
            </div>
            <div style={{ width: '50px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 }}>
              {comp.current != null ? comp.current.toFixed(4) : '--'}
            </div>
          </div>
        )
      })}
      <div style={{
        marginTop: '4px', paddingTop: '6px', borderTop: '1px solid var(--border-light)',
        display: 'flex', justifyContent: 'flex-end', fontSize: '12px', color: 'var(--text-secondary)',
      }}>
        合计：<span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: totalContribution >= 0 ? chartTheme.green : chartTheme.red, marginLeft: '6px' }}>
          {totalContribution >= 0 ? '+' : ''}{totalContribution.toFixed(2)}%
        </span>
      </div>
    </div>
  )
}

function CrossAssetChart({ dxyHistory, goldCorr, spxCorr, goldPrice, spxPrice }: {
  dxyHistory: { date: string; value: number }[]
  goldCorr: number; spxCorr: number
  goldPrice: number | null; spxPrice: number | null
}) {
  const chartTheme = useChartTheme()
  const hasGold = goldPrice != null
  const hasSpx = spxPrice != null

  return (
    <div class="forex-grid-2">
      <div style={{
        background: 'var(--bg-card)', borderRadius: '12px', padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: '8px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>DXY vs 黄金</div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            60日相关系数：<span style={{ color: goldCorr < -0.5 ? chartTheme.green : goldCorr > 0.3 ? chartTheme.red : chartTheme.textSecondary, fontWeight: 700 }}>
              {hasGold ? goldCorr.toFixed(2) : '--'}
            </span>
          </div>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {hasGold
            ? <>传统负相关关系：美元走强 → 黄金走弱。60日相关系数：{goldCorr.toFixed(2)}
              {goldCorr < -0.5 ? '（强负相关，传统关系成立）'
                : goldCorr > -0.3 ? '（弱/正相关，可能受地缘政治或央行购金影响）'
                : '（中度负相关）'}</>
            : <>黄金历史日线数据尚未同步，无法计算相关性。请在服务器端运行相关数据同步脚本后查看。</>}
        </div>
        <div style={{ display: 'flex', gap: '20px', marginTop: '4px' }}>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>DXY</div>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: chartTheme.blue }}>
              {dxyHistory.length > 0 ? dxyHistory[dxyHistory.length - 1].value.toFixed(2) : '--'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>黄金 (USD/oz)</div>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: chartTheme.gold }}>
              {hasGold ? `${goldPrice.toFixed(0)}` : '--'}
            </div>
          </div>
        </div>
      </div>

      <div style={{
        background: 'var(--bg-card)', borderRadius: '12px', padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: '8px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>DXY vs S&P 500</div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            60日相关系数：<span style={{ color: spxCorr < -0.3 ? chartTheme.green : spxCorr > 0.3 ? chartTheme.gold : chartTheme.textSecondary, fontWeight: 700 }}>
              {hasSpx ? spxCorr.toFixed(2) : '--'}
            </span>
          </div>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {hasSpx
            ? <>美元与美股关系随周期变化。当前60日相关系数：{spxCorr.toFixed(2)}
              {spxCorr < -0.3 ? '（负相关：强美元压制美股，避险逻辑）'
                : spxCorr > 0.3 ? '（正相关：美元与美股齐涨，美国例外论）'
                : '（弱相关/无明确方向）'}</>
            : <>S&P 500 历史日线数据尚未同步（数据库 asset_prices 表中无 ^GSPC 数据）。请在服务器端运行相应数据同步脚本后查看。</>}
        </div>
        <div style={{ display: 'flex', gap: '20px', marginTop: '4px' }}>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>DXY</div>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: chartTheme.blue }}>
              {dxyHistory.length > 0 ? dxyHistory[dxyHistory.length - 1].value.toFixed(2) : '--'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>S&P 500</div>
            <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: chartTheme.textPrimary }}>
              {hasSpx ? spxPrice.toFixed(0) : '--'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatsTable({ stats }: { stats: DxyInfo['stats'] }) {
  const chartTheme = useChartTheme()
  const keys = ['1Y', '3Y', '5Y', '10Y', '20Y']
  const labelMap: Record<string, string> = { '1Y': '1年', '3Y': '3年', '5Y': '5年', '10Y': '10年', '20Y': '20年' }
  return (
    <div style={{ overflowX: 'auto', minWidth: 0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', fontFamily: 'var(--font-mono)', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '8px 8px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)', width: '60px' }}>时间窗</th>
            <th style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>Z分位</th>
            <th style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>百分位</th>
            <th style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>均值</th>
            <th style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>标准差</th>
            <th style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>最低</th>
            <th style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>最高</th>
            <th style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>样本</th>
          </tr>
        </thead>
        <tbody>
          {keys.map(key => {
            const s = stats[key]
            if (!s) return null
            const zColor = s.zScore > 1 ? chartTheme.green : s.zScore < -1 ? chartTheme.red : chartTheme.textSecondary
            return (
              <tr key={key} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td style={{ padding: '8px 8px', color: 'var(--text-primary)', fontWeight: 600 }}>{labelMap[key]}</td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: zColor, fontWeight: 700 }}>{s.zScore.toFixed(2)}</td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: chartTheme.textSecondary }}>{s.percentile.toFixed(1)}%</td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: chartTheme.textSecondary }}>{s.mean.toFixed(2)}</td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: chartTheme.textSecondary }}>{s.std.toFixed(2)}</td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: chartTheme.textSecondary }}>{s.min.toFixed(2)}</td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: chartTheme.textSecondary }}>{s.max.toFixed(2)}</td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>{s.dataPoints}天</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function ForexDashboard() {
  const chartTheme = useChartTheme()
  const [data, setData] = useState<ForexData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/api/v1/forex.json')
      .then(r => r.json())
      .then(res => {
        if (!res.success) { setError(res.error || '请求失败'); return }
        setData(res.data)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSkeleton type="chart" height={500} />
  if (error) return <div style={{ padding: '40px', textAlign: 'center', color: chartTheme.red, fontSize: '14px' }}>{error}</div>
  if (!data) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>暂无汇率数据</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <HeroRow data={data} />

      <MacroCard title="DXY 美元指数走势">
        <TrendChart history={data.dxy.history} title="DXY" color={chartTheme.blue} />
      </MacroCard>

      <MacroCard title="全球主要货币对">
        <PairsGrid pairs={data.pairs} />
      </MacroCard>

      <div class="forex-grid-2">
        <MacroCard title="DXY 成分贡献分析">
          <DxyComposition components={data.dxyComponents} />
        </MacroCard>
        <MacroCard title="DXY 多周期统计">
          <StatsTable stats={data.dxy.stats} />
        </MacroCard>
      </div>

      <MacroCard title="跨资产联动分析">
        <CrossAssetChart
          dxyHistory={data.dxy.history}
          goldCorr={data.dxyGoldCorr}
          spxCorr={data.dxySpxCorr}
          goldPrice={data.goldPrice}
          spxPrice={data.spxPrice}
        />
      </MacroCard>

      <div style={{
        padding: '12px 16px', background: 'var(--bg-card)', borderRadius: '12px',
        fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.8,
      }}>
        <strong style={{ color: 'var(--text-secondary)' }}>数据说明：</strong>
        美元指数（DXY）衡量美元相对一篮子六种货币（欧元 57.6% / 日元 13.6% / 英镑 11.9% / 加元 9.1% / 瑞典克朗 4.2% / 瑞郎 3.6%）的汇率变化。
        DXY 上升代表美元走强。<br />
        <strong style={{ color: 'var(--text-secondary)' }}> 美元微笑理论：</strong>
        美元在全球衰退期（避险需求）或美国经济强劲增长期（美国例外论）走强，在温和增长期走弱。<br />
        <strong style={{ color: 'var(--text-secondary)' }}> 关键指标：</strong>
        USD/CNH 反映中美贸易摩擦与资本流动压力；USD/JPY 反映套息交易风险偏好；AUD/USD 反映全球风险偏好与大宗商品需求。
        数据来源：Yahoo Finance，日频数据。
      </div>

      <style>
{`
  .forex-grid-4-hero {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 1px;
    background: var(--bg-card);
    border-radius: 12px;
    overflow: hidden;
  }
  .forex-grid-4-pairs {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    background: var(--bg-card);
    border-radius: 12px;
    overflow: hidden;
  }
  .forex-grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    min-width: 0;
  }
  @media (max-width: 960px) {
    .forex-grid-4-hero { grid-template-columns: 1fr 1fr; }
    .forex-grid-4-pairs { grid-template-columns: repeat(2, 1fr); }
    .forex-grid-2 { grid-template-columns: 1fr; }
  }
  @media (max-width: 520px) {
    .forex-grid-4-hero { grid-template-columns: 1fr; }
    .forex-grid-4-pairs { grid-template-columns: 1fr; }
  }
`}
      </style>
    </div>
  )
}
