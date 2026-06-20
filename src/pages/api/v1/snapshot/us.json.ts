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
    sectorEtfs,
    allAssets,
    vixIndicator,
  ] = await Promise.all([
    safeQuery(
      `SELECT a.symbol, a.name_zh AS name, s.last_price AS price,
              COALESCE(s.change_percent, 0) AS \`change\`
       FROM asset_snapshots s
       JOIN assets a ON a.id = s.asset_id
       WHERE a.is_active = TRUE AND a.sub_category = '美股'
       ORDER BY FIELD(a.symbol, '^GSPC', '^IXIC', '^DJI', '^RUT')`
    ),
    safeQuery(
      `SELECT i.code, i.name_zh AS name, d.value, i.unit
       FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code IN ('VIXCLS','FEDFUNDS','DGS10','DEXUSEU')
         AND d.period_date = (SELECT MAX(d2.period_date) FROM indicator_data d2 WHERE d2.indicator_id = d.indicator_id)`
    ),
    safeQuery(
      `SELECT a.symbol, a.name_zh AS name, s.last_price AS price,
              COALESCE(s.change_percent, 0) AS \`change\`
       FROM asset_snapshots s
       JOIN assets a ON a.id = s.asset_id
       WHERE a.is_active = TRUE AND a.sub_category = '行业ETF'
       ORDER BY \`change\` DESC`
    ),
    safeQuery(
      `SELECT a.symbol, a.name_zh AS name, a.sub_category,
              s.last_price AS price, COALESCE(s.change_percent, 0) AS \`change\`, s.volume
       FROM asset_snapshots s
       JOIN assets a ON a.id = s.asset_id
       WHERE a.is_active = TRUE`
    ),
    safeQuery(
      `SELECT d.value FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = 'VIXCLS'
         AND d.period_date = (SELECT MAX(d2.period_date) FROM indicator_data d2 WHERE d2.indicator_id = d.indicator_id)`
    ),
  ])

  const mag7Symbols = ['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA']
  const mag7 = allAssets
    .filter((a: any) => mag7Symbols.includes(a.symbol))
    .map((a: any) => ({ symbol: a.symbol, name: a.name, change: a.change }))

  const soxAsset = allAssets.find((a: any) => a.symbol === 'SOX')
  const sox = soxAsset ? { price: Number(soxAsset.price), change: Number(soxAsset.change) } : undefined

  const stockAssets = allAssets.filter((a: any) => a.sub_category === '美股' || a.sub_category === '行业ETF')
  const advances = stockAssets.filter((a: any) => Number(a.change) > 0).length
  const declines = stockAssets.filter((a: any) => Number(a.change) < 0).length

  const marketInternals = {
    breadth: { advance: advances, decline: declines, newHigh: 0, newLow: 0 },
    maDist: { above20: 0, above50: 0, above200: 0 },
    mag7: mag7.length > 0 ? mag7 : undefined,
    sox,
  }

  const vixVal = vixIndicator?.[0]?.value
  const vix = vixVal != null ? Number(vixVal) : undefined
  const sentiment = {
    vix,
    cta: vix != null ? (vix < 15 ? '偏乐观' : vix > 25 ? '偏防御' : '中性') : '--',
    watchPoints: vix != null ? [
      `VIX ${vix.toFixed(1)}` + (vix < 15 ? ' 处于低位，市场情绪偏乐观' : vix > 25 ? ' 偏高，警惕波动加剧' : ' 处于中性区间'),
      mag7.length > 0 ? 'Mag7 涨跌分化，关注龙头动向' : '等待 Mag7 数据同步',
    ] : ['等待波动率数据同步'],
  }

  const topVolume = [...allAssets]
    .filter((a: any) => a.volume != null)
    .sort((a: any, b: any) => Number(b.volume) - Number(a.volume))
    .slice(0, 3)
    .map((a: any) => ({ symbol: a.symbol, name: a.name, ratio: 1.5, change: Number(a.change) }))

  const momentumCands = [...stockAssets]
    .filter((a: any) => Number(a.change) > 1.5)
    .sort((a: any, b: any) => Number(b.change) - Number(a.change))
    .slice(0, 3)
    .map((a: any) => ({ symbol: a.symbol, name: a.name, change: Number(a.change), reason: '连续走强' }))

  const reversalCands = [...stockAssets]
    .filter((a: any) => Number(a.change) < -1.5)
    .sort((a: any, b: any) => Number(a.change) - Number(b.change))
    .slice(0, 3)
    .map((a: any) => ({ symbol: a.symbol, name: a.name, change: Number(a.change), reason: '明显回调' }))

  const microAnomaly = {
    volume: topVolume.length > 0 ? topVolume : [],
    options: [],
    momentum: momentumCands,
    reversal: reversalCands,
  }

  const spx = coreIndices.find((i: any) => i.symbol === '^GSPC')
  const ndx = coreIndices.find((i: any) => i.symbol === '^IXIC')
  const dgs10 = macroRiskIndicators.find((r: any) => r.code === 'DGS10')
  const fedfunds = macroRiskIndicators.find((r: any) => r.code === 'FEDFUNDS')

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
        coreIndices,
        macroRisk: macroRiskIndicators.map((r: any) => ({
          code: r.code, name: r.name, value: r.value, unit: r.unit,
        })),
        sectorTheme: sectorEtfs.map((s: any) => ({
          symbol: s.symbol, name: s.name, change: s.change,
        })),
        marketInternals,
        sentiment,
        microAnomaly,
        summary: { evidence, falsify, action },
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}, 300)
