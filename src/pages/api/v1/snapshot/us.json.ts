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
    coreIndices,
    macroRiskIndicators,
    vixIndicator,
  ] = await Promise.all([
    safeQuery(
      `SELECT a.symbol, a.name_zh AS name, s.last_price AS price,
              COALESCE(s.change_percent, 0) AS \`change\`, a.sub_category
       FROM asset_snapshots s
       JOIN assets a ON a.id = s.asset_id
       WHERE a.is_active = TRUE
         AND (a.sub_category = '美股' OR a.sub_category = '指数ETF' OR a.symbol IN ('SOX','^VIX'))
       ORDER BY FIELD(a.symbol, '^GSPC', '^IXIC', '^DJI', '^RUT', 'SOX', '^VIX')`
    ),
    safeQuery(
      `SELECT i.code, i.name_zh AS name, d.value, i.unit
       FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code IN ('VIXCLS','FEDFUNDS','DGS10','DEXUSEU')
         AND d.period_date = (SELECT MAX(d2.period_date) FROM indicator_data d2 WHERE d2.indicator_id = d.indicator_id)`
    ),
    safeQuery(
      `SELECT d.value FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = 'VIXCLS'
         AND d.period_date = (SELECT MAX(d2.period_date) FROM indicator_data d2 WHERE d2.indicator_id = d.indicator_id)`
    ),
  ])

  const vixVal = vixIndicator?.[0]?.value
  const vix = vixVal != null ? Number(vixVal) : undefined

  const dgs10 = macroRiskIndicators.find((r: any) => r.code === 'DGS10')
  const fedfunds = macroRiskIndicators.find((r: any) => r.code === 'FEDFUNDS')

  const rateExtra: any[] = []
  if (dgs10) rateExtra.push({ symbol: 'US10Y', name: '10Y 美债收益率', price: Number(dgs10.value), change: 0 })
  if (fedfunds) rateExtra.push({ symbol: 'FEDFUNDS', name: '联邦基金利率', price: Number(fedfunds.value), change: 0 })

  const expandedCoreIndices = [
    ...coreIndices,
    ...rateExtra.filter((r) => !coreIndices.some((i: any) => i.symbol === r.symbol)),
  ]

  const spx = expandedCoreIndices.find((i: any) => i.symbol === '^GSPC')
  const ndx = expandedCoreIndices.find((i: any) => i.symbol === '^IXIC')

  const evidence: string[] = []
  const falsify: string[] = []
  const action: string[] = []

  if (spx && Number(spx.change) >= 0) {
    evidence.push(`标普500 收于 ${Number(spx.price).toFixed(0)} 点${Number(spx.change) >= 0 ? '，维持近期高位' : ''}`)
  } else if (spx) {
    falsify.push(`标普500 回调 ${Math.abs(Number(spx.change)).toFixed(2)}%，短期承压`)
  }
  if (ndx) {
    const nch = Number(ndx.change)
    if (nch > 0) evidence.push(`纳斯达克 ${nch > 0.5 ? '领涨' : '小幅'} +${nch.toFixed(2)}%，科技股偏强`)
    else falsify.push(`纳斯达克 ${nch.toFixed(2)}%，科技板块走弱`)
  }
  if (dgs10 && fedfunds) {
    const spread = Number(dgs10.value) - Number(fedfunds.value)
    if (spread < 0) {
      falsify.push(`国债收益率曲线倒挂 ${Math.abs(spread).toFixed(2)}bp，衰退信号尚未解除`)
    } else {
      evidence.push(`利差 ${spread.toFixed(2)}bp，收益率曲线正常化`)
    }
  }
  if (vix != null && vix < 18) {
    evidence.push(`VIX ${vix.toFixed(1)} 低位运行，市场情绪平稳`)
  } else if (vix != null && vix > 25) {
    falsify.push(`VIX ${vix.toFixed(1)}，波动率偏高，注意尾部风险`)
  }

  if (evidence.length === 0) evidence.push('等待更多数据同步后生成分析')
  action.push('维持现有敞口，关注本周宏观数据发布')
  if (vix != null && vix < 15) action.push('波动率偏低，可考虑适度对冲')
  else if (vix != null && vix > 25) action.push('波动率偏高，建议降低仓位或买入保护')
  action.push('重点关注 FOMC 会议纪要及 PCE 数据')

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        header: {
          date: new Date().toISOString().slice(0, 10),
          status: 'active',
          conclusion: evidence.length > 0 ? evidence[0] : '',
        },
        coreIndices: expandedCoreIndices,
        macroRisk: macroRiskIndicators.map((r: any) => ({
          code: r.code, name: r.name, value: r.value, unit: r.unit,
        })),
        summary: { evidence, falsify, action },
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}, 300)
