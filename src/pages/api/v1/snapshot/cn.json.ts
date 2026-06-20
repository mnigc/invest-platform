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
  const [
    indices,
    marketSentiment,
    swSectors,
  ] = await Promise.all([
    safeQuery(
      `SELECT index_code AS symbol, index_name AS name, close_price AS price,
              COALESCE(change_pct, 0) AS \`change\`
       FROM index_daily
       WHERE category = 'main'
         AND trade_date = (SELECT MAX(trade_date) FROM index_daily WHERE category = 'main')
       ORDER BY FIELD(index_code, '000001','399001','399006','000688','899050')`
    ),
    safeQuery(
      `SELECT index_code AS symbol, index_name AS name, close_price AS price,
              COALESCE(change_pct, 0) AS \`change\`
       FROM index_daily
       WHERE category = 'style'
         AND trade_date = (SELECT MAX(trade_date) FROM index_daily WHERE category = 'style')
       ORDER BY FIELD(index_code, '399364','399365','399366','399367','399368','399369')`
    ),
    safeQuery(
      `SELECT index_code AS code, index_name AS name, close_price AS price,
              COALESCE(change_pct, 0) AS \`change\`
       FROM index_daily
       WHERE category = 'sw_l1'
         AND trade_date = (SELECT MAX(trade_date) FROM index_daily WHERE category = 'sw_l1')
       ORDER BY change_pct DESC`
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
  if (swSectors.length > 0) {
    const topSec = swSectors[0]
    const botSec = swSectors[swSectors.length - 1]
    if (topSec && Number(topSec.change) > 0) evidence.push(`申万行业多数上涨，${topSec.name} 领涨 +${Number(topSec.change).toFixed(2)}%`)
    if (botSec && Number(botSec.change) < 0) falsify.push(`${botSec.name} 领跌 ${Number(botSec.change).toFixed(2)}%`)
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
        styleIndices: marketSentiment.map((s: any) => ({
          symbol: s.symbol, name: s.name, change: s.change,
        })),
        sectors: swSectors.map((s: any) => ({
          code: s.code, name: s.name, change: s.change, price: s.price,
        })),
        fundFlow: { northbound: 0, southbound: 0, margin: 0 },
        valuation: {
          overallPE: undefined,
          overallSignal: undefined,
          industries: [],
        },
        summary: { evidence, falsify, action },
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}, 300)
