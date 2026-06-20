import { Hono } from 'hono'
import { query } from '../../db/pool.js'
import { cacheMiddleware } from '../../middleware/cache.js'

const router = new Hono()

async function safeQuery(sql: string): Promise<any[]> {
  try {
    const rows = await query(sql)
    return Array.isArray(rows) ? rows : []
  } catch (err: any) {
    console.error(`[safeQuery] ${sql.slice(0, 60)}...`, err.message)
    return []
  }
}

// GET /api/v1/snapshot/us — 美国市场仪表盘聚合
router.get('/us', cacheMiddleware(300), async (c) => {
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

  // --- marketInternals ---
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

  // --- sentiment ---
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

  // --- microAnomaly ---
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

  // --- dynamic summary ---
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

  return c.json({
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
  })
})

// GET /api/v1/snapshot/cn — 中国市场仪表盘聚合
router.get('/cn', cacheMiddleware(300), async (c) => {
  const [
    indices,
    marketSentiment,
    swSectors,
    industryValuation,
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
    safeQuery(
      `SELECT industry AS name,
              ROUND(AVG(pe_ttm), 2) AS pe,
              ROUND(AVG(pb), 2) AS pb,
              COUNT(*) AS stockCount
       FROM core_stock_indicator
       WHERE trade_date = (SELECT MAX(trade_date) FROM core_stock_indicator)
         AND pe_ttm > 0 AND pe_ttm < 200
       GROUP BY industry
       ORDER BY pe DESC`
    ),
  ])

  // 全市场估值
  const allPe = industryValuation.filter((v: any) => v.pe && v.pe > 0)
  const overallPE = allPe.length > 0
    ? Math.round(allPe.reduce((s: number, v: any) => s + Number(v.pe), 0) / allPe.length * 10) / 10
    : undefined
  const overallSignal = overallPE != null
    ? (overallPE < 15 ? '偏低' : overallPE < 25 ? '中性' : '偏高')
    : undefined

  // --- dynamic summary ---
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
  if (overallSignal === '偏低') action.push('整体估值偏低，中长期布局窗口')
  else if (overallSignal === '偏高') action.push('整体估值偏高，注意回调风险')
  action.push('关注 LPR 及社融数据发布')

  const headerSentiment = overallSignal === '偏高' ? 'warning'
    : overallSignal === '偏低' ? 'positive'
    : 'neutral'

  return c.json({
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
        overallPE,
        overallSignal,
        industries: industryValuation.map((v: any) => ({
          name: v.name, pe: v.pe, pb: v.pb, stockCount: v.stockCount,
        })),
      },
      summary: { evidence, falsify, action },
    },
  })
})

export default router
