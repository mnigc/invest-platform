export const prerender = false

import type { APIRoute } from 'astro'
import { query } from '../../../lib/db'
import { withCache } from '../../../lib/cache'

async function safeQuery(sql: string, params?: any[]): Promise<any[]> {
  try {
    const rows = await query(sql, params)
    return Array.isArray(rows) ? rows : []
  } catch (err: any) {
    console.error('[etf-flow] safeQuery', err.message)
    return []
  }
}

const fmt = (v: number | null, d = 2): number | null => (v == null ? null : +Number(v).toFixed(d))

async function getAggregate(days: number) {
  const rows = await safeQuery(
    `SELECT d.trade_date,
            SUM(d.amount) AS total_amount,
            SUM(s.net_amount_yuan) AS total_net
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
     GROUP BY d.trade_date
     ORDER BY d.trade_date ASC`
  )
  return rows.slice(-days).map((r: any) => {
    const amt = Number(r.total_amount || 0)
    const net = Number(r.total_net || 0)
    return {
      date: String(r.trade_date).slice(0, 10),
      amount: fmt(amt / 1e8, 2),
      net: fmt(net / 1e8, 2),
      ratio: amt ? fmt(net / amt, 4) : null,
    }
  })
}

export const GET = withCache(async ({ request }) => {
  const url = new URL(request.url)
  const detailCode = url.searchParams.get('detail')

  if (detailCode) {
    const meta = await safeQuery(
      `SELECT code, name, exchange, track_index, category FROM etf_master WHERE code = ? AND is_active = 1`,
      [detailCode]
    )
    if (meta.length === 0) {
      return new Response(JSON.stringify({ success: false, error: `未知 ETF: ${detailCode}` }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    const m = meta[0]
    const prices = await safeQuery(
      `SELECT trade_date, close, amount, turnover, change_pct
       FROM etf_daily WHERE code = ? AND close IS NOT NULL ORDER BY trade_date ASC`,
      [detailCode]
    )
    const shares = await safeQuery(
      `SELECT trade_date, shares_10k FROM etf_shares WHERE code = ? AND shares_10k IS NOT NULL ORDER BY trade_date ASC`,
      [detailCode]
    )

    // 净申赎金额 = Δ份额(万份)*10000*收盘价
    const shareRows = shares.slice(-400)
    const priceMap = new Map<string, any>()
    for (const r of prices) priceMap.set(String(r.trade_date).slice(0, 10), r)
    const netFlowMap = new Map<string, number | null>()
    for (let i = 1; i < shareRows.length; i++) {
      const cur = shareRows[i]
      const prev = shareRows[i - 1]
      const d = String(cur.trade_date).slice(0, 10)
      const pr = priceMap.get(d)
      if (pr) {
        const delta = Number(cur.shares_10k) - Number(prev.shares_10k)
        const close = Number(pr.close)
        netFlowMap.set(d, close > 0 ? delta * 10000 * close : null)
      } else {
        netFlowMap.set(d, null)
      }
    }

    return new Response(JSON.stringify({
      success: true,
      data: {
        code: String(m.code),
        name: String(m.name),
        exchange: m.exchange,
        track_index: m.track_index,
        category: m.category,
        price: prices.slice(-260).map((r: any) => ({ date: String(r.trade_date).slice(0, 10), close: fmt(Number(r.close)), amount: fmt(Number(r.amount) / 1e8, 2) })),
        shares: shares.slice(-260).map((r: any) => ({ date: String(r.trade_date).slice(0, 10), shares: fmt(Number(r.shares_10k), 2) })),
        netFlow: prices.slice(-260).map((r: any) => {
          const d = String(r.trade_date).slice(0, 10)
          const v = netFlowMap.get(d)
          return { date: d, net: v != null ? fmt(v / 1e8, 2) : null }
        }),
      },
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  const agg = await getAggregate(25)

  // ── ETF 列表（含份额动量）──
  const list = await safeQuery(`
    SELECT m.code, m.name, m.exchange, m.track_index, m.category,
           d.trade_date AS last_date, d.close, d.change_pct, d.amount,
           s.shares_10k AS shares,
           (SELECT shares_10k FROM etf_shares x WHERE x.code = m.code AND x.trade_date IN (
               SELECT MAX(y.trade_date) FROM etf_shares y WHERE y.code = m.code AND y.trade_date < s.trade_date)
             LIMIT 1) AS shares_prev
    FROM etf_master m
    LEFT JOIN etf_daily d ON d.code = m.code AND d.trade_date = (
      SELECT MAX(x.trade_date) FROM etf_daily x WHERE x.code = m.code AND x.close IS NOT NULL)
    LEFT JOIN etf_shares s ON s.code = m.code AND s.trade_date = (
      SELECT MAX(x.trade_date) FROM etf_shares x WHERE x.code = m.code AND x.shares_10k IS NOT NULL)
    WHERE m.is_active = 1
    ORDER BY m.category, m.code
  `)

  // 5/20 日份额变化
  const changers = await safeQuery(`
    SELECT x.code, x.trade_date, x.shares_10k
    FROM etf_shares x
    JOIN etf_master m ON m.code = x.code AND m.is_active = 1
    WHERE x.trade_date >= CURDATE() - INTERVAL 30 DAY
  `)
  const byCode = new Map<string, { date: string; shares: number }[]>()
  for (const r of changers) {
    const c = String(r.code)
    if (!byCode.has(c)) byCode.set(c, [])
    byCode.get(c)!.push({ date: String(r.trade_date).slice(0, 10), shares: Number(r.shares_10k) })
  }
  const momentum = (code: string, days: number): number | null => {
    const arr = byCode.get(code)
    if (!arr || arr.length < 2) return null
    const cur = arr[arr.length - 1].shares
    let base: number | null = null
    const target = arr[arr.length - 1].date
    for (let i = arr.length - 2; i >= 0; i--) {
      const dt = new Date(arr[i].date)
      const td = new Date(target)
      const diff = (td.getTime() - dt.getTime()) / 86400000
      if (diff >= days * 1.2) { base = arr[i].shares; break }
    }
    if (base == null) base = arr[0].shares
    return base && base > 0 ? (cur / base - 1) : null
  }

  const etfList = list.map((r: any) => {
    const shares = r.shares != null ? Number(r.shares) : null
    const prev = r.shares_prev != null ? Number(r.shares_prev) : null
    const oneDayNet = shares != null && prev != null && prev !== shares
      ? (shares - prev) * 10000 * (r.close != null ? Number(r.close) : 0)
      : null
    return {
      code: String(r.code),
      name: String(r.name),
      exchange: String(r.exchange),
      track_index: r.track_index,
      category: r.category,
      close: fmt(r.close),
      changePct: fmt(r.change_pct),
      amount: r.amount != null ? fmt(Number(r.amount) / 1e8, 2) : null,
      shares: fmt(shares, 4),
      sharesChange1d: shares != null && prev != null ? fmt((shares / prev - 1) * 100, 3) : null,
      net1d: oneDayNet != null ? fmt(oneDayNet / 1e8, 3) : null,
      sharesChange5d: momentum(String(r.code), 5),
      sharesChange20d: momentum(String(r.code), 20),
    }
  })

  // ── 按日明细表（最近 8 个交易日，宽基+行业）──
  const dailyTable = await safeQuery(`
    SELECT d.trade_date, m.code, m.name, m.category, d.change_pct, d.amount,
           s.shares_10k, s2.shares_10k AS shares_prev,
           (s.shares_10k - s2.shares_10k) * 10000 * NULLIF(d.close, 0) AS net_amount
    FROM etf_master m
    JOIN etf_daily d ON d.code = m.code
    JOIN etf_shares s ON s.code = m.code AND s.trade_date = d.trade_date
    LEFT JOIN etf_shares s2 ON s2.code = m.code AND s2.trade_date = (
      SELECT MAX(x.trade_date) FROM etf_shares x WHERE x.code = m.code AND x.trade_date < d.trade_date)
    WHERE d.trade_date >= CURDATE() - INTERVAL 12 DAY
      AND m.is_active = 1 AND s.shares_10k IS NOT NULL
    ORDER BY d.trade_date DESC, d.amount DESC
  `)

  const tableRows = dailyTable.slice(0, 60).map((r: any) => {
    const amt = Number(r.amount || 0)
    const net = r.net_amount != null ? Number(r.net_amount) : null
    return {
      date: String(r.trade_date).slice(0, 10),
      code: String(r.code),
      name: String(r.name),
      category: r.category,
      changePct: fmt(r.change_pct, 2),
      amount: fmt(amt / 1e8, 2),
      net: net != null ? fmt(net / 1e8, 2) : null,
      ratio: amt && net != null ? fmt(net / amt, 4) : null,
    }
  })

  // ── 汇总卡（自然周）──
  const weeks: any[] = []
  if (agg.length > 0) {
    const weekGroups = new Map<string, any[]>()
    for (const p of agg) {
      const d = new Date(p.date)
      const day = (d.getDay() + 6) % 7
      d.setDate(d.getDate() - day)
      const key = d.toISOString().slice(0, 10)
      if (!weekGroups.has(key)) weekGroups.set(key, [])
      weekGroups.get(key)!.push(p)
    }
    const keys = [...weekGroups.keys()].sort().slice(-4)
    weeks.push(...keys.map(k => {
      const pts = weekGroups.get(k)!
      const totalAmount = pts.reduce((s, v) => s + (v.amount || 0), 0)
      const totalNet = pts.reduce((s, v) => s + (v.net || 0), 0)
      return {
        weekStart: k,
        days: pts.length,
        totalAmount: fmt(totalAmount, 2),
        totalNet: fmt(totalNet, 2),
        ratio: totalAmount ? fmt(totalNet / totalAmount, 4) : null,
      }
    }))
  }

  return new Response(JSON.stringify({
    success: true,
    data: {
      updatedAt: new Date().toISOString().slice(0, 10),
      aggregate: agg,
      weeks,
      etfList,
      dailyTable: tableRows,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}, 300)
