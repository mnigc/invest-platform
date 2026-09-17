export const prerender = false

import { query, queryOne } from '../../../../lib/db'
import { toDateStr } from '../../../../lib/date'
import { withCache } from '../../../../lib/cache'
import type { Anomaly, BacktestSnapshot, BacktestSummary } from '../../../../lib/core'

// 「一年前」基期的最大允许偏差：月频序列发布常滞后数周，超窗视为基期缺失
const YoY_WINDOW_DAYS = 45

async function yoyAtDate(code: string, asOf: string, region: string = 'US'): Promise<number | null> {
  try {
    const rows = await query<any>(
      `SELECT d.period_date, d.value FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = ? AND i.region = ? AND d.period_date <= ? AND d.value IS NOT NULL
       ORDER BY d.period_date DESC LIMIT 24`,
      [code, region, asOf]
    )
    if (!rows || rows.length < 2) return null
    const current = Number(rows[0].value)
    const asOfMs = new Date(toDateStr(rows[0].period_date)).getTime()
    const yearAgoTargetMs = asOfMs - 365.25 * 24 * 3600 * 1000
    let yearAgo: number | null = null
    let minDiff = Number.POSITIVE_INFINITY
    for (const r of rows) {
      const diff = Math.abs(new Date(toDateStr(r.period_date)).getTime() - yearAgoTargetMs)
      if (diff < minDiff) { minDiff = diff; yearAgo = Number(r.value) }
    }
    // 基期距「一年前」过远（序列历史不足或断档）→ 不产出失真的同比
    if (yearAgo == null || yearAgo === 0 || minDiff > YoY_WINDOW_DAYS * 24 * 3600 * 1000) return null
    return +(((current - yearAgo) / yearAgo) * 100).toFixed(2)
  } catch { return null }
}

async function latestVal(code: string, region: string = 'US'): Promise<number | null> {
  try {
    const row = await queryOne<any>(
      `SELECT d.value FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = ? AND i.region = ? AND d.value IS NOT NULL
       ORDER BY d.period_date DESC LIMIT 1`,
      [code, region]
    )
    return row ? Number(row.value) : null
  } catch { return null }
}

async function latestYoY(code: string, region: string = 'US'): Promise<number | null> {
  return yoyAtDate(code, new Date().toISOString().slice(0, 10), region)
}

async function valNDaysAgo(code: string, offset: number, region: string = 'US'): Promise<number | null> {
  try {
    const row = await queryOne<any>(
      `SELECT d.value FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = ? AND i.region = ? AND d.value IS NOT NULL
       ORDER BY d.period_date DESC LIMIT 1 OFFSET ?`,
      [code, region, offset]
    )
    return row ? Number(row.value) : null
  } catch { return null }
}

async function detectAnomalies(): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = []

  // 全部查询互相独立，一次性并行发出（Neon WebSocket 每查询一个往返，串行链线性放大延迟）
  const [dgs10, dgs2, vix, bbb, cpi, fedfunds, cfnai, dfii10, t10yie, vixPrev] = await Promise.all([
    latestVal('DGS10'),
    latestVal('DGS2'),
    latestVal('VIXCLS'),
    latestVal('BAMLC0A4CBBB'),
    latestYoY('CPI'),
    latestVal('FEDFUNDS'),
    latestVal('CFNAI'),
    latestVal('DFII10'),
    latestVal('T10YIE'),
    valNDaysAgo('VIXCLS', 22),
  ])

  // 数据缺失的检查直接跳过，不再用硬编码默认值冒充真实数据触发/压制异常信号
  const slope = dgs10 != null && dgs2 != null ? dgs10 - dgs2 : null

  if (slope != null && slope < -0.5) {
    anomalies.push({
      id: 'yield-curve-deep-inversion',
      title: '深度收益率曲线倒挂',
      description: '10Y-2Y 利差深度倒挂，历史衰退信号',
      severity: 'high', indicator: 'DGS10, DGS2',
      currentValue: `${slope.toFixed(2)}%`, threshold: '< -0.50%',
    })
  }

  if (bbb != null && vix != null && bbb > 2.5 && vix > 25) {
    anomalies.push({
      id: 'credit-panic',
      title: '信用市场恐慌',
      description: '信用利差扩大 + 波动率飙升，系统性压力信号',
      severity: 'critical', indicator: 'BAMLC0A4CBBB, VIXCLS',
      currentValue: `BBB ${bbb.toFixed(2)}% / VIX ${vix.toFixed(1)}`,
      threshold: 'BBB > 2.5% & VIX > 25',
    })
  }

  if (cpi != null && fedfunds != null && cpi > 5 && cpi > fedfunds) {
    anomalies.push({
      id: 'inflation-out-of-control',
      title: '通胀远超政策利率',
      description: '实际利率深度为负，央行滞后于通胀曲线',
      severity: 'high', indicator: 'CPI, FEDFUNDS',
      currentValue: `CPI ${cpi.toFixed(1)}% > Fed ${fedfunds.toFixed(2)}%`,
      threshold: 'CPI > FedFunds',
    })
  }

  if (cfnai != null && cfnai < -0.7) {
    anomalies.push({
      id: 'cfnai-recession',
      title: '经济活动深度收缩',
      description: 'CFNAI 低于 -0.7，经济进入衰退区',
      severity: 'high', indicator: 'CFNAI',
      currentValue: cfnai.toFixed(3), threshold: '< -0.70',
    })
  }

  if (cfnai != null && cpi != null && cfnai < 0 && cpi > 4) {
    anomalies.push({
      id: 'stagflation-signal',
      title: '滞胀风险',
      description: '经济增长放缓 + 通胀高企，类1970s滞胀情景',
      severity: 'high', indicator: 'CFNAI, CPI',
      currentValue: `CFNAI ${cfnai.toFixed(3)} / CPI ${cpi.toFixed(1)}%`,
      threshold: 'CFNAI < 0 & CPI > 4%',
    })
  }

  if (dfii10 != null && dfii10 > 2.5) {
    anomalies.push({
      id: 'real-rate-spike',
      title: '实际利率偏高',
      description: 'TIPS 实际利率超过 2.5%，流动性收紧信号',
      severity: 'medium', indicator: 'DFII10',
      currentValue: `${dfii10.toFixed(2)}%`, threshold: '> 2.50%',
    })
  }

  if (t10yie != null && cpi != null && t10yie > 3 && cpi < 3) {
    anomalies.push({
      id: 'expectation-deanchor',
      title: '通胀预期脱锚',
      description: '盈亏平衡通胀率高于实际CPI，市场预期远超现实',
      severity: 'medium', indicator: 'T10YIE, CPI',
      currentValue: `T10YIE ${t10yie.toFixed(2)}% / CPI ${cpi.toFixed(1)}%`,
      threshold: 'T10YIE > 3% & CPI < 3%',
    })
  }

  if (vix != null && vix > 20 && vixPrev != null && vixPrev > 0) {
    const vixChange = (vix - vixPrev) / vixPrev
    if (vixChange > 0.4) {
      anomalies.push({
        id: 'volatility-shock',
        title: '波动率冲击',
        description: `VIX 一月内飙升 ${(vixChange * 100).toFixed(0)}%，市场恐慌情绪急剧升温`,
        severity: 'medium', indicator: 'VIXCLS',
        currentValue: `${vix.toFixed(1)} (${(vixChange * 100).toFixed(0)}% MoM)`,
        threshold: '月变化 > 40%',
      })
    }
  }

  return anomalies
}

export const GET = withCache(async ({ request }: { request: Request }) => {
  const url = new URL(request.url)
  const path = url.pathname
  const subPath = path.split('/').pop()

  if (subPath === 'anomalies.json') {
    return await handleAnomalies()
  } else if (subPath === 'backtest.json') {
    return await handleBacktest(url)
  }

  return new Response(
    JSON.stringify({ success: false, error: 'Not found' }),
    { status: 404, headers: { 'Content-Type': 'application/json' } }
  )
}, 600)

async function handleAnomalies(): Promise<Response> {
  try {
    const anomalies = await detectAnomalies()
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          anomalies,
          totalCount: anomalies.length,
          highCount: anomalies.filter(a => a.severity === 'high' || a.severity === 'critical').length,
          updatedAt: new Date().toISOString().slice(0, 10),
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[Anomaly]', err.message)
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

async function handleBacktest(url: URL): Promise<Response> {
  try {
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
    const startDate = DATE_RE.test(url.searchParams.get('startDate') || '') ? url.searchParams.get('startDate')! : '2010-01-01'
    const endDateRaw = url.searchParams.get('endDate') || ''
    const endDate = DATE_RE.test(endDateRaw) ? endDateRaw : new Date().toISOString().slice(0, 10)
    if (startDate > endDate) {
      return new Response(
        JSON.stringify({ success: false, error: 'startDate must be <= endDate' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 直接读取预计算的回测数据（1次查询，替代原来1200+次查询）
    const snapshots = await query<any>(
      `SELECT snapshot_date as date, regime, label, confidence, sp500_price,
              fwd_return_1m, fwd_return_3m, fwd_return_6m, fwd_return_12m
       FROM regime_snapshots
       WHERE snapshot_date BETWEEN ? AND ?
       ORDER BY snapshot_date ASC`,
      [startDate, endDate]
    )

    const snapshotsFormatted: BacktestSnapshot[] = snapshots.map((s: any) => ({
      date: toDateStr(s.date),
      regime: s.regime,
      label: s.label,
      confidence: s.confidence,
      sp500Price: Number(s.sp500_price),
      forwardReturns: {
        1: Number(s.fwd_return_1m) || 0,
        3: Number(s.fwd_return_3m) || 0,
        6: Number(s.fwd_return_6m) || 0,
        12: Number(s.fwd_return_12m) || 0,
      },
    }))

    // 多指数价格序列（与快照日期对齐：取 <= 快照日最近价，避免未来函数）
    let indexSeries: { symbol: string; nameZh: string; dates: string[]; data: (number | null)[] }[] = []
    try {
      const INDEX_LIST = [
        { symbol: '^GSPC', nameZh: '标普500指数' },
        { symbol: '^IXIC', nameZh: '纳斯达克综合指数' },
        { symbol: '^DJI', nameZh: '道琼斯工业平均' },
        { symbol: '^RUT', nameZh: '罗素2000' },
      ]
      const snapshotDates = snapshotsFormatted.map((s) => s.date)
      // 只取快照起点（往前留一个月缓存）之后的行情，避免拉取全量历史（^GSPC 达上万行）
      const priceFloor = new Date(snapshotDates[0])
      priceFloor.setMonth(priceFloor.getMonth() - 1)
      const priceFloorStr = toDateStr(priceFloor)
      const priceRowsList = await Promise.all(
        INDEX_LIST.map((idx) =>
          query<any>(
            `SELECT ap.trade_date, ap.close_price
             FROM asset_prices ap
             JOIN assets a ON a.id = ap.asset_id
             WHERE a.symbol = ? AND ap.close_price IS NOT NULL AND ap.close_price > 0
               AND ap.trade_date >= ?
             ORDER BY ap.trade_date ASC`,
            [idx.symbol, priceFloorStr]
          )
        )
      )
      const sortedList = priceRowsList.map((priceRows) =>
        priceRows.map((r: any) => ({
          date: toDateStr(r.trade_date),
          price: Number(r.close_price),
        }))
      )
      for (const idx of INDEX_LIST) {
        const sorted = sortedList[INDEX_LIST.indexOf(idx)]
        let m = -1
        const seriesData: (number | null)[] = []
        for (const d of snapshotDates) {
          while (m + 1 < sorted.length && sorted[m + 1].date <= d) m++
          seriesData.push(m >= 0 ? sorted[m].price : null)
        }
        indexSeries.push({ symbol: idx.symbol, nameZh: idx.nameZh, dates: snapshotDates, data: seriesData })
      }
    } catch (e: any) {
      console.warn('[RegimeBacktest] 多指数价格不可用', e.message)
    }

    // 预计算的多指数汇总统计 + 直接读取预计算的汇总统计（并行，单表失败不拖垮整个接口）
    const safeSummaryQuery = async (sqlStr: string, values: any[]) => {
      try {
        return await query<any>(sqlStr, values)
      } catch (e: any) {
        console.warn('[RegimeBacktest] 汇总表查询失败', e.message)
        return []
      }
    }
    let indexSummaries: { symbol: string; nameZh: string; rows: BacktestSummary[] }[] = []
    let summaries: BacktestSummary[] = []
    const [idxSumRawResult, summariesRawResult] = await Promise.all([
      safeSummaryQuery(
        // 只取最新一段 (period_start, period_end)：历史多次同步会留下多段区间，
        // 若不加此限定，同一指数同一体制会重复出现多行（表格"叠加"）。
        `SELECT index_symbol, index_name_zh, regime, label, count, avg_confidence,
                avg_return_1m, avg_return_3m, avg_return_6m, avg_return_12m,
                win_rate_1m, win_rate_3m, win_rate_6m, win_rate_12m
         FROM regime_index_summaries
         WHERE (period_start, period_end) = (
                 SELECT period_start, period_end
                 FROM regime_index_summaries
                 WHERE period_start >= ? AND period_end <= ?
                 ORDER BY period_end DESC, period_start DESC
                 LIMIT 1
               )
         ORDER BY index_symbol ASC, count DESC`,
        [startDate, endDate]
      ),
      safeSummaryQuery(
        `SELECT regime, label, count, avg_confidence,
                avg_return_1m, avg_return_3m, avg_return_6m, avg_return_12m,
                win_rate_1m, win_rate_3m, win_rate_6m, win_rate_12m
         FROM regime_backtest_summaries
         WHERE (period_start, period_end) = (
                 SELECT period_start, period_end
                 FROM regime_backtest_summaries
                 WHERE period_start >= ? AND period_end <= ?
                 ORDER BY period_end DESC, period_start DESC
                 LIMIT 1
               )
         ORDER BY count DESC`,
        [startDate, endDate]
      ),
    ])
    try {
      const byIndex = new Map<string, { nameZh: string; rows: BacktestSummary[] }>()
      const seenRegimes = new Map<string, Set<string>>() // symbol -> 已收录 regime，兜底防脏数据重复
      for (const s of idxSumRawResult) {
        const seen = seenRegimes.get(s.index_symbol) ?? new Set<string>()
        if (seen.has(s.regime)) continue
        seen.add(s.regime)
        seenRegimes.set(s.index_symbol, seen)

        const row: BacktestSummary = {
          regime: s.regime,
          label: s.label,
          count: s.count,
          avgConfidence: Number(s.avg_confidence) * 100,
          avgReturn1m: Number(s.avg_return_1m),
          avgReturn3m: Number(s.avg_return_3m),
          avgReturn6m: Number(s.avg_return_6m),
          avgReturn12m: Number(s.avg_return_12m),
          winRate1m: Number(s.win_rate_1m),
          winRate3m: Number(s.win_rate_3m),
          winRate6m: Number(s.win_rate_6m),
          winRate12m: Number(s.win_rate_12m),
        }
        const entry = byIndex.get(s.index_symbol) ?? { nameZh: s.index_name_zh, rows: [] as BacktestSummary[] }
        entry.rows.push(row)
        byIndex.set(s.index_symbol, entry)
      }
      indexSummaries = [...byIndex.entries()].map(([symbol, entry]) => ({ symbol, ...entry }))
    } catch (e: any) {
      console.warn('[RegimeBacktest] 多指数汇总不可用', e.message)
    }

    summaries = summariesRawResult.map((s: any) => ({
      regime: s.regime,
      label: s.label,
      count: s.count,
      avgConfidence: Number(s.avg_confidence) * 100,
      avgReturn1m: Number(s.avg_return_1m),
      avgReturn3m: Number(s.avg_return_3m),
      avgReturn6m: Number(s.avg_return_6m),
      avgReturn12m: Number(s.avg_return_12m),
      winRate1m: Number(s.win_rate_1m),
      winRate3m: Number(s.win_rate_3m),
      winRate6m: Number(s.win_rate_6m),
      winRate12m: Number(s.win_rate_12m),
    }))

    const total = snapshotsFormatted.length
    const overall = {
      startDate,
      endDate,
      totalSnapshots: total,
      avgReturn1m: total > 0 ? +(snapshotsFormatted.reduce((s, x) => s + x.forwardReturns[1], 0) / total).toFixed(4) : 0,
      avgReturn3m: total > 0 ? +(snapshotsFormatted.reduce((s, x) => s + x.forwardReturns[3], 0) / total).toFixed(4) : 0,
      avgReturn6m: total > 0 ? +(snapshotsFormatted.reduce((s, x) => s + x.forwardReturns[6], 0) / total).toFixed(4) : 0,
      avgReturn12m: total > 0 ? +(snapshotsFormatted.reduce((s, x) => s + x.forwardReturns[12], 0) / total).toFixed(4) : 0,
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: { snapshots: snapshotsFormatted, summaries, overall, indexSeries, indexSummaries },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[RegimeBacktest]', err.message)
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
