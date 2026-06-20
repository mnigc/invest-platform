import { Hono } from 'hono'
import { query } from '../../db/pool.js'
import { detectRegime } from './regime-engine.js'
import type { BacktestSnapshot, BacktestSummary, BacktestResponse, RegimeType } from '@invest/core'

const router = new Hono()

const LABELS: Record<RegimeType, string> = {
  GOLDILOCKS: '金发女孩', RISK_ON: '风险偏好', OVERHEAT: '过热',
  STAGFLATION: '滞胀', RISK_OFF: '风险规避', RECOVERY: '复苏', UNKNOWN: '不确定',
}

function addMonths(date: string, n: number): string {
  const d = new Date(date)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

function monthEnds(start: string, end: string): string[] {
  const dates: string[] = []
  let d = new Date(start)
  const endD = new Date(end)
  while (d <= endD) {
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    const me = lastDay <= endD ? lastDay : endD
    dates.push(me.toISOString().slice(0, 10))
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
  }
  return dates
}

router.get('/backtest', async (c) => {
  try {
    const startDate = c.req.query('startDate') || '2010-01-01'
    const endDate = c.req.query('endDate') || new Date().toISOString().slice(0, 10)

    // Fetch SP500 prices
    const prices = await query<any>(
      `SELECT ap.trade_date, ap.close_price
       FROM asset_prices ap
       JOIN assets a ON a.id = ap.asset_id
       WHERE a.symbol = '^GSPC' AND ap.trade_date BETWEEN ? AND ?
       ORDER BY ap.trade_date ASC`,
      [startDate, endDate]
    )

    if (prices.length < 2) {
      return c.json({
        success: true,
        data: {
          snapshots: [],
          summaries: [],
          overall: { startDate, endDate, totalSnapshots: 0, avgReturn1m: 0, avgReturn3m: 0, avgReturn6m: 0, avgReturn12m: 0 },
        } satisfies BacktestResponse,
      })
    }

    const priceMap = new Map<string, number>()
    prices.forEach((p: any) => priceMap.set(p.trade_date.toISOString().slice(0, 10), Number(p.close_price)))
    const sortedDates = [...priceMap.keys()].sort()

    function priceAt(date: string): number | null {
      // Find closest price on or before the given date
      for (let i = sortedDates.length - 1; i >= 0; i--) {
        if (sortedDates[i] <= date) return priceMap.get(sortedDates[i])!
      }
      return null
    }

    const evalDates = monthEnds(startDate, endDate)
    const snapshots: BacktestSnapshot[] = []

    for (const date of evalDates) {
      const spPrice = priceAt(date)
      if (spPrice === null) continue

      const regime = await detectRegime(date)

      const forwardMonths = [1, 3, 6, 12] as const
      const returns: { 1: number; 3: number; 6: number; 12: number } = { 1: 0, 3: 0, 6: 0, 12: 0 }

      for (const m of forwardMonths) {
        const fwdDate = addMonths(date, m)
        const fwdPrice = priceAt(fwdDate)
        if (fwdPrice && fwdPrice > 0) {
          returns[m] = +(fwdPrice / spPrice - 1).toFixed(4)
        }
      }

      snapshots.push({
        date,
        regime: regime.regime,
        label: regime.label,
        confidence: regime.confidence,
        sp500Price: spPrice,
        forwardReturns: returns,
      })
    }

    // Aggregate by regime
    const byRegime = new Map<RegimeType, BacktestSnapshot[]>()
    for (const s of snapshots) {
      const arr = byRegime.get(s.regime) || []
      arr.push(s)
      byRegime.set(s.regime, arr)
    }

    const summaries: BacktestSummary[] = []
    for (const [regime, snaps] of byRegime) {
      const n = snaps.length
      const avg = (field: (s: BacktestSnapshot) => number) =>
        +(snaps.reduce((sum, s) => sum + field(s), 0) / n).toFixed(4)
      const winRate = (field: (s: BacktestSnapshot) => number) =>
        +(snaps.filter(s => field(s) > 0).length / n).toFixed(4)

      summaries.push({
        regime,
        label: LABELS[regime] || regime,
        count: n,
        avgConfidence: avg(s => s.confidence),
        avgReturn1m: avg(s => s.forwardReturns[1]),
        avgReturn3m: avg(s => s.forwardReturns[3]),
        avgReturn6m: avg(s => s.forwardReturns[6]),
        avgReturn12m: avg(s => s.forwardReturns[12]),
        winRate1m: winRate(s => s.forwardReturns[1]),
        winRate3m: winRate(s => s.forwardReturns[3]),
        winRate6m: winRate(s => s.forwardReturns[6]),
        winRate12m: winRate(s => s.forwardReturns[12]),
      })
    }

    summaries.sort((a, b) => b.count - a.count)

    const total = snapshots.length
    const overall = {
      startDate,
      endDate,
      totalSnapshots: total,
      avgReturn1m: +(snapshots.reduce((s, x) => s + x.forwardReturns[1], 0) / Math.max(total, 1)).toFixed(4),
      avgReturn3m: +(snapshots.reduce((s, x) => s + x.forwardReturns[3], 0) / Math.max(total, 1)).toFixed(4),
      avgReturn6m: +(snapshots.reduce((s, x) => s + x.forwardReturns[6], 0) / Math.max(total, 1)).toFixed(4),
      avgReturn12m: +(snapshots.reduce((s, x) => s + x.forwardReturns[12], 0) / Math.max(total, 1)).toFixed(4),
    }

    return c.json({
      success: true,
      data: { snapshots, summaries, overall } satisfies BacktestResponse,
    })
  } catch (err: any) {
    console.error('[RegimeBacktest]', err.message)
    c.status(500)
    return c.json({ success: false, error: err.message })
  }
})

export default router
