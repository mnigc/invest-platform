export const prerender = false

import type { APIRoute } from 'astro'
import { query } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'

async function safeQuery(sql: string): Promise<any[]> {
  try {
    const rows = await query(sql)
    return Array.isArray(rows) ? rows : []
  } catch (err: any) {
    console.error(`[safeQuery] ${sql.slice(0, 60)}...`, err.message)
    return []
  }
}

export const GET = withCache(async () => {
  const [indices, valuationRows] = await Promise.all([
    safeQuery(
      `WITH latest AS (
         SELECT index_code, index_name, trade_date, close_price,
                ROW_NUMBER() OVER (PARTITION BY index_code ORDER BY trade_date DESC) AS rn
         FROM index_daily
         WHERE category = 'main' AND close_price IS NOT NULL
       )
       SELECT
         l.index_code AS symbol,
         l.index_name AS name,
         l.trade_date,
         l.close_price AS price,
         ((l.close_price - p.close_price) / p.close_price * 100) AS \`change\`
       FROM latest l
       LEFT JOIN index_daily p
         ON p.index_code = l.index_code
         AND p.close_price IS NOT NULL
         AND p.trade_date = (
           SELECT MAX(trade_date)
           FROM index_daily
           WHERE index_code = l.index_code AND close_price IS NOT NULL AND trade_date < l.trade_date
         )
       WHERE l.rn = 1
       ORDER BY FIELD(l.index_code, '000001','399001','399006','000688','899050','000016','000300','000852','000905')`
    ),
    safeQuery(
      `SELECT overall_pe, overall_pb, overall_signal, industries_json
       FROM cn_valuation
       ORDER BY date DESC LIMIT 1`
    ),
  ])

  const shIdx = indices.find((i: any) => i.symbol === '000001')
  const szIdx = indices.find((i: any) => i.symbol === '399001')
  const cyIdx = indices.find((i: any) => i.symbol === '399006')

  const evidence: string[] = []
  const falsify: string[] = []
  const action: string[] = []

  if (shIdx) {
    const ch = Number(shIdx.change)
    if (ch >= 0) evidence.push(`上证指数收于 ${Number(shIdx.price).toFixed(0)} 点，${ch > 0.5 ? '涨幅 ' + ch.toFixed(2) + '%' : '窄幅震荡'}`)
    else falsify.push(`上证指数回调 ${Math.abs(ch).toFixed(2)}%`)
  }
  if (cyIdx) {
    const cch = Number(cyIdx.change)
    if (cch > 0.5) evidence.push(`创业板 ${cch > 1 ? '强势' : '温和'}上涨 ${cch.toFixed(2)}%，成长风格占优`)
    else if (cch < -0.5) falsify.push(`创业板 ${cch.toFixed(2)}%，成长板块承压`)
  }
  if (evidence.length === 0) evidence.push('A股市场窄幅整理，等待方向选择')
  action.push('维持均衡配置，关注政策面变化')
  action.push('关注 LPR 及社融数据发布')

  const headerSentiment = 'neutral'

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        header: {
          tradeDate: new Date().toISOString().slice(0, 10),
          sentiment: headerSentiment,
          conclusion: evidence.length > 0 ? evidence[0] : '',
        },
        indices: indices.map((i: any) => ({
          symbol: i.symbol, name: i.name, price: i.price, change: i.change,
        })),
        valuation: (() => {
          const v = valuationRows?.[0]
          let industries: any[] = []
          try {
            industries = v?.industries_json ? JSON.parse(v.industries_json) : []
          } catch (e) {
            console.error('[cn.json.ts] parse industries_json failed', e)
          }
          return {
            overallPE: v?.overall_pe != null ? Number(v.overall_pe) : undefined,
            overallPB: v?.overall_pb != null ? Number(v.overall_pb) : undefined,
            overallSignal: v?.overall_signal || undefined,
            industries: Array.isArray(industries) ? industries : [],
          }
        })(),
        summary: { evidence, falsify, action },
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}, 300)
