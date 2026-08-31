export const prerender = false

import type { APIRoute } from 'astro'
import { query, queryOne } from '../../../../lib/db'
import { toDateStr } from '../../../../lib/date'
import type { Anomaly, BacktestSnapshot, BacktestSummary } from '../../../../lib/core'

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
    const asOfDate = String(rows[0].period_date)
    const yearAgoTarget = new Date(asOfDate)
    yearAgoTarget.setFullYear(new Date(asOfDate).getFullYear() - 1)
    const yearAgoStr = yearAgoTarget.toISOString().slice(0, 10)
    let yearAgo: number | null = null
    let minDiff = Number.POSITIVE_INFINITY
    for (const r of rows) {
      const d = String(r.period_date)
      const diff = Math.abs(new Date(d).getTime() - new Date(yearAgoStr).getTime())
      if (diff < minDiff) { minDiff = diff; yearAgo = Number(r.value) }
    }
    if (yearAgo == null || yearAgo === 0) return null
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

  const dgs10 = await latestVal('DGS10')
  const dgs2 = await latestVal('DGS2')
  const vix = await latestVal('VIXCLS')
  const bbb = await latestVal('BAMLC0A4CBBB')
  const cpi = await latestYoY('CPI')
  const fedfunds = await latestVal('FEDFUNDS')
  const cfnai = await latestVal('CFNAI')
  const dfii10 = await latestVal('DFII10')
  const t10yie = await latestVal('T10YIE')
  const vixPrev = await valNDaysAgo('VIXCLS', 22)

  const f = (v: number | null, fb: number) => v ?? fb
  const gDgs10 = f(dgs10, 4.3)
  const gDgs2 = f(dgs2, 4.7)
  const gVix = f(vix, 14)
  const gBbb = f(bbb, 1.2)
  const gCpi = f(cpi, 3.0)
  const gFedfunds = f(fedfunds, 5.25)
  const gCfnai = f(cfnai, 0.05)
  const gDfii10 = f(dfii10, 1.8)
  const gT10yie = f(t10yie, 2.2)
  const slope = gDgs10 - gDgs2

  if (slope < -0.5) {
    anomalies.push({
      id: 'yield-curve-deep-inversion',
      title: '深度收益率曲线倒挂',
      description: '10Y-2Y 利差深度倒挂，历史衰退信号',
      severity: 'high', indicator: 'DGS10, DGS2',
      currentValue: `${slope.toFixed(2)}%`, threshold: '< -0.50%',
    })
  }

  if (gBbb > 2.5 && gVix > 25) {
    anomalies.push({
      id: 'credit-panic',
      title: '信用市场恐慌',
      description: '信用利差扩大 + 波动率飙升，系统性压力信号',
      severity: 'critical', indicator: 'BAMLC0A4CBBB, VIXCLS',
      currentValue: `BBB ${gBbb.toFixed(2)}% / VIX ${gVix.toFixed(1)}`,
      threshold: 'BBB > 2.5% & VIX > 25',
    })
  }

  if (gCpi > 5 && gCpi > gFedfunds) {
    anomalies.push({
      id: 'inflation-out-of-control',
      title: '通胀远超政策利率',
      description: '实际利率深度为负，央行滞后于通胀曲线',
      severity: 'high', indicator: 'CPI, FEDFUNDS',
      currentValue: `CPI ${gCpi.toFixed(1)}% > Fed ${gFedfunds.toFixed(2)}%`,
      threshold: 'CPI > FedFunds',
    })
  }

  if (gCfnai < -0.7) {
    anomalies.push({
      id: 'cfnai-recession',
      title: '经济活动深度收缩',
      description: 'CFNAI 低于 -0.7，经济进入衰退区',
      severity: 'high', indicator: 'CFNAI',
      currentValue: gCfnai.toFixed(3), threshold: '< -0.70',
    })
  }

  if (gCfnai < 0 && gCpi > 4) {
    anomalies.push({
      id: 'stagflation-signal',
      title: '滞胀风险',
      description: '经济增长放缓 + 通胀高企，类1970s滞胀情景',
      severity: 'high', indicator: 'CFNAI, CPI',
      currentValue: `CFNAI ${gCfnai.toFixed(3)} / CPI ${gCpi.toFixed(1)}%`,
      threshold: 'CFNAI < 0 & CPI > 4%',
    })
  }

  if (gDfii10 > 2.5) {
    anomalies.push({
      id: 'real-rate-spike',
      title: '实际利率偏高',
      description: 'TIPS 实际利率超过 2.5%，流动性收紧信号',
      severity: 'medium', indicator: 'DFII10',
      currentValue: `${gDfii10.toFixed(2)}%`, threshold: '> 2.50%',
    })
  }

  if (gT10yie > 3 && gCpi < 3) {
    anomalies.push({
      id: 'expectation-deanchor',
      title: '通胀预期脱锚',
      description: '盈亏平衡通胀率高于实际CPI，市场预期远超现实',
      severity: 'medium', indicator: 'T10YIE, CPI',
      currentValue: `T10YIE ${gT10yie.toFixed(2)}% / CPI ${gCpi.toFixed(1)}%`,
      threshold: 'T10YIE > 3% & CPI < 3%',
    })
  }

  if (gVix > 20 && vixPrev !== null && vixPrev > 0) {
    const vixChange = (gVix - vixPrev) / vixPrev
    if (vixChange > 0.4) {
      anomalies.push({
        id: 'volatility-shock',
        title: '波动率冲击',
        description: `VIX 一月内飙升 ${(vixChange * 100).toFixed(0)}%，市场恐慌情绪急剧升温`,
        severity: 'medium', indicator: 'VIXCLS',
        currentValue: `${gVix.toFixed(1)} (${(vixChange * 100).toFixed(0)}% MoM)`,
        threshold: '月变化 > 40%',
      })
    }
  }

  return anomalies
}

export const GET = async ({ request }: { request: Request }) => {
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
}

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
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

async function handleBacktest(url: URL): Promise<Response> {
  try {
    const startDate = url.searchParams.get('startDate') || '2010-01-01'
    const endDate = url.searchParams.get('endDate') || new Date().toISOString().slice(0, 10)

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
      for (const idx of INDEX_LIST) {
        const priceRows = await query<any>(
          `SELECT ap.trade_date, ap.close_price
           FROM asset_prices ap
           JOIN assets a ON a.id = ap.asset_id
           WHERE a.symbol = ? AND ap.close_price IS NOT NULL AND ap.close_price > 0
           ORDER BY ap.trade_date ASC`,
          [idx.symbol]
        )
        const sorted = priceRows.map((r: any) => ({
          date: toDateStr(r.trade_date),
          price: Number(r.close_price),
        }))
        const data: (number | null)[] = []
        let j = -1
        for (const d of snapshotDates) {
          while (j + 1 < sorted.length && sorted[j + 1].date <= d) j++
          data.push(j >= 0 ? sorted[j].price : null)
        }
        indexSeries.push({ symbol: idx.symbol, nameZh: idx.nameZh, dates: snapshotDates, data })
      }
    } catch (e: any) {
      console.warn('[RegimeBacktest] 多指数价格不可用', e.message)
    }

    // 预计算的多指数汇总统计
    let indexSummaries: { symbol: string; nameZh: string; rows: BacktestSummary[] }[] = []
    try {
      const idxSumRaw = await query<any>(
        `SELECT index_symbol, index_name_zh, regime, label, count, avg_confidence,
                avg_return_1m, avg_return_3m, avg_return_6m, avg_return_12m,
                win_rate_1m, win_rate_3m, win_rate_6m, win_rate_12m
         FROM regime_index_summaries
         WHERE period_start >= ? AND period_end <= ?
         ORDER BY index_symbol ASC, count DESC`,
        [startDate, endDate]
      )
      const byIndex = new Map<string, { nameZh: string; rows: BacktestSummary[] }>()
      for (const s of idxSumRaw) {
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

    // 直接读取预计算的汇总统计
    const summariesRaw = await query<any>(
      `SELECT regime, label, count, avg_confidence,
              avg_return_1m, avg_return_3m, avg_return_6m, avg_return_12m,
              win_rate_1m, win_rate_3m, win_rate_6m, win_rate_12m
       FROM regime_backtest_summaries
       WHERE period_start >= ? AND period_end <= ?
       ORDER BY count DESC`,
      [startDate, endDate]
    )

    const summaries: BacktestSummary[] = summariesRaw.map((s: any) => ({
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
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
