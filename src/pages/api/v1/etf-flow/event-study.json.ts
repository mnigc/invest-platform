export const prerender = false

import type { APIRoute } from 'astro'
import { query } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'
import { type SeriesPoint, eventStudy, zScore, percentileRank, quantile, mean, corr } from '../../../../lib/analysis'

async function safeQuery(sql: string, params?: any[]): Promise<any[]> {
  try {
    const rows = await query(sql, params)
    return Array.isArray(rows) ? rows : []
  } catch (err: any) {
    console.error('[etf-flow/event-study] safeQuery', err.message)
    return []
  }
}

const HORIZONS = [1, 5, 20, 60]

export const GET = withCache(async () => {
  try {
    // 1) 宽基合计净申赎（近 3 年）
    const flowRows = await safeQuery(`
      SELECT d.trade_date,
             (SUM(s.net_amount_yuan) / NULLIF(SUM(d.amount), 0)) AS ratio,
             SUM(d.amount) AS total_amount,
             SUM(s.net_amount_yuan) / 1e8 AS total_net_yi
      FROM etf_daily d
      JOIN (
        SELECT s1.code, s1.trade_date,
               (s1.shares_10k - s2.shares_10k) * 10000 * NULLIF(d2.close, 0) AS net_amount_yuan
        FROM etf_shares s1
        JOIN (SELECT code, trade_date, shares_10k FROM etf_shares) s2
          ON s2.code = s1.code AND s2.trade_date = (
               SELECT MAX(s3.trade_date) FROM etf_shares s3 WHERE s3.code = s1.code AND s3.trade_date < s1.trade_date)
        LEFT JOIN etf_daily d2 ON d2.code = s1.code AND d2.trade_date = s1.trade_date
        JOIN etf_master m ON m.code = s1.code AND m.category = 'broad' AND m.is_active = 1
        WHERE s1.is_converted = 0
      ) s ON s.code = d.code AND s.trade_date = d.trade_date
      WHERE d.trade_date >= CURDATE() - INTERVAL 3 YEAR AND d.close IS NOT NULL
      GROUP BY d.trade_date
      HAVING SUM(d.amount) > 0
      ORDER BY d.trade_date ASC
    `)

    // 2) 沪深300 收盘价（index_daily）
    const hs300 = await safeQuery(`
      SELECT trade_date, close_price FROM index_daily
      WHERE index_code = '000300' AND close_price IS NOT NULL
      ORDER BY trade_date ASC
    `)

    if (flowRows.length < 40 || hs300.length < 40) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          ready: false,
          nFlow: flowRows.length,
          nIndex: hs300.length,
          message: '数据积累中：需要至少 40 个交易日宽基资金流与沪深300数据后进行事件研究',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const flowSeries: SeriesPoint[] = flowRows.map((r: any) => ({
      date: String(r.trade_date).slice(0, 10),
      value: Number(r.ratio),
    }))
    const netYiSeries: SeriesPoint[] = flowRows.map((r: any) => ({
      date: String(r.trade_date).slice(0, 10),
      value: Number(r.total_net_yi),
    }))
    const csi300: SeriesPoint[] = hs300.map((r: any) => ({
      date: String(r.trade_date).slice(0, 10),
      value: Number(r.close_price),
    }))

    // 3) 事件定义：申赎率 z-score 极端
    const ratioVals = flowSeries.map(p => p.value)
    const latestRatio = ratioVals[ratioVals.length - 1]
    const latestZ = zScore(ratioVals, latestRatio)
    const pct = percentileRank(ratioVals, latestRatio)

    const buyEvents: string[] = []
    const sellEvents: string[] = []
    let lastType = ''
    for (const p of flowSeries) {
      const z = zScore(ratioVals, p.value)
      const type = z >= 2 ? 'buy' : z <= -2 ? 'sell' : ''
      if (type && type !== lastType) {
        if (type === 'buy') buyEvents.push(p.date)
        else sellEvents.push(p.date)
        lastType = type
      } else if (!type) {
        lastType = ''
      }
    }

    // 4) 事件研究：沪深300 后市 1/5/20/60 日
    const buyStudy = eventStudy(csi300, buyEvents, HORIZONS)
    const sellStudy = eventStudy(csi300, sellEvents, HORIZONS)

    // 5) 分组对比：申赎率 P90+ vs P10- vs 中间
    const groupStats = (subset: string[]): { n: number; median: number; mean: number; winRate: number } => {
      const prices = csi300
      const vals: number[] = []
      for (const d of subset) {
        let idx = -1
        for (let i = 0; i < prices.length; i++) {
          if (prices[i].date <= d) idx = i
          else break
        }
        if (idx < 0 || idx + 20 >= prices.length) continue
        const base = prices[idx].value
        const fwd = prices[idx + 20].value
        if (base > 0) vals.push(+((fwd / base) - 1).toFixed(4))
      }
      if (vals.length === 0) return { n: 0, median: 0, mean: 0, winRate: 0 }
      const sorted = [...vals].sort((a, b) => a - b)
      return {
        n: vals.length,
        median: +quantile(sorted, 0.5).toFixed(4),
        mean: +mean(vals).toFixed(4),
        winRate: +(vals.filter(v => v > 0).length / vals.length).toFixed(4),
      }
    }

    const allDates = flowSeries.map(p => p.date)
    const sortedVals = [...ratioVals].sort((a, b) => a - b)
    const poolCut = quantile(sortedVals, 0.90)
    const lowCut = quantile(sortedVals, 0.10)
    const topPool: string[] = []
    const bottomPool: string[] = []
    flowSeries.forEach((p, i) => {
      if (ratioVals[i] >= poolCut) topPool.push(p.date)
      else if (ratioVals[i] <= lowCut) bottomPool.push(p.date)
    })

    const groups = [
      { group: '净申购 ≥ P90', key: 'buy', ...groupStats(topPool) },
      { group: '净赎回 ≤ P10', key: 'sell', ...groupStats(bottomPool) },
    ]

    // 6) 领先滞后：当日净申赎率 vs 未来 t~t+k 日沪深300 收益
    const lags: { k: number; corr: number }[] = []
    const maxK = 15
    for (let k = 0; k <= maxK; k++) {
      const pairs: [number, number][] = []
      const flowMap = new Map(flowSeries.map(p => [p.date, p.value]))
      for (let i = 0; i < csi300.length - k; i++) {
        const f = flowMap.get(csi300[i].date)
        const fb = flowMap.get(csi300[i + k].date)
        // 前复权收益：以 csi300 两日收盘计算
        const p0 = csi300[i].value
        const p1 = csi300[i + k].value
        if (f != null && p0 > 0 && p1 > 0) {
          pairs.push([f, Math.log(p1 / p0) / (k > 0 ? k : 1)])
        }
      }
      lags.push({ k, corr: pairs.length > 10 ? corr(pairs.map(x => x[0]), pairs.map(x => x[1])) : 0 })
    }

    // 7) 当前读数 + 结论
    const latest = flowRows[flowRows.length - 1]
    const latestDate = String(latest.trade_date).slice(0, 10)
    const currentPair = buyStudy.horizons['20']

    return new Response(JSON.stringify({
      success: true,
      data: {
        ready: true,
        updatedAt: new Date().toISOString().slice(0, 10),
        latest: {
          date: latestDate,
          ratio: +latestRatio.toFixed(4),
          z: +latestZ.toFixed(2),
          percentile: pct,
          netYi: latest.total_net_yi != null ? +Number(latest.total_net_yi).toFixed(2) : null,
          amountYi: latest.total_amount != null ? +Number(latest.total_amount / 1e8).toFixed(2) : null,
          // 历史统计引用（信息性）
          buyAfter20d: currentPair,
        },
        events: {
          buy: buyStudy,
          sell: sellStudy,
        },
        groups,
        lags,
        series: {
          ratio: flowSeries.slice(-260).map(p => ({ date: p.date, value: +p.value.toFixed(4) })),
          netYi: netYiSeries.slice(-260).map(p => ({ date: p.date, value: +p.value.toFixed(2) })),
          csi300: csi300.slice(-260).map(p => ({ date: p.date, value: p.value })),
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('[etf-flow/event-study]', err.message)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}, 300)
