export const prerender = false

import type { APIRoute } from 'astro'
import { query } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'

async function safeQuery(sql: string, params?: any[]): Promise<any[]> {
  try {
    const rows = await query(sql, params)
    return Array.isArray(rows) ? rows : []
  } catch (err: any) {
    console.error('[gold/overview] safeQuery', err.message)
    return []
  }
}

// 1万盎司 = 10000 / 32150.746 吨
const OZ_10K_TO_TONNES = 10000 / 32150.746

// 补充中文名映射（修复当前数据库中未识别的名称）
const CN_NAME_MAP: Record<string, string> = {
  'Kyrgyz Rep.': '吉尔吉斯斯坦',
  'Kazakhstan, Rep. of': '哈萨克斯坦',
  'Uzbekistan, Rep. of': '乌兹别克斯坦',
  'Netherlands, The': '荷兰',
  'Turkey': '土耳其',
  'Egypt, Arab Rep. of': '埃及',
  'Czech Rep.': '捷克',
  'Serbia, Rep. of': '塞尔维亚',
  'Slovak Rep.': '斯洛伐克',
  'Slovenia, Rep. of': '斯洛文尼亚',
  'Belarus, Rep. of': '白俄罗斯',
  'Tajikistan, Rep. of': '塔吉克斯坦',
  'Azerbaijan, Rep. of': '阿塞拜疆',
  'Armenia, Rep. of': '亚美尼亚',
  'Macedonia': '北马其顿',
  'Afghanistan, Islamic Rep. of': '阿富汗',
  'Bahrain, Kingdom of': '巴林',
  'Mozambique, Rep. of': '莫桑比克',
  'Syrian Arab Republic': '叙利亚',
  'Venezuela, Republica Bolivariana de': '委内瑞拉',
  'Bosnia and Herzegovina': '波黑',
  'Croatia': '克罗地亚',
  'Brunei Darussalam': '文莱',
  'Mauritius': '毛里求斯',
  'North Macedonia, Republic of': '北马其顿',
  'Moldova': '摩尔多瓦',
  'Montenegro': '黑山',
  'Trinidad and Tobago': '特立尼达和多巴哥',
  'Curaçao and Sint Maarten': '库拉索和圣马丁',
  'Netherlands Antilles': '荷属安的列斯',
  'Aruba, Kingdom of the Netherlands': '阿鲁巴',
  'Bahamas, The': '巴哈马',
  'Taiwan Province of China': '中国台湾',
  'China, P.R.: Mainland': '中国',
}

function getCnName(countryName: string, countryNameCn: string | null): string {
  if (!countryName) return ''
  const s = String(countryName).trim()
  const mapped = CN_NAME_MAP[s]
  if (mapped) return mapped
  const cn = countryNameCn ? String(countryNameCn).trim() : ''
  return cn || s
}

export const GET = withCache(async () => {
  // 1) 各国最新持有量（用于 Hero 卡片和表格 + 趋势图终点）
  // 排除 World/Euro Area 等汇总项；每个国家取自己最新日期的记录
  const holdings = await safeQuery(`
    SELECT t.country_name,
           t.country_name_cn,
           t.region,
           t.holding_tonnes,
           t.share_of_total_reserves,
           t.period_date
    FROM gold_reserves t
    INNER JOIN (
      SELECT country_name, MAX(period_date) AS max_date
      FROM gold_reserves
      GROUP BY country_name
    ) m ON t.country_name = m.country_name AND t.period_date = m.max_date
    WHERE t.holding_tonnes IS NOT NULL
      AND t.country_name NOT IN ('World', 'Euro Area (incl. ECB)', 'Euro Area')
      AND t.country_name_cn NOT IN ('World', '欧元区')
    ORDER BY t.holding_tonnes DESC
    LIMIT 60
  `)

  // 2) 取持有量 Top 10 的国家作为趋势图主角（排除美国和汇总项）
  const topCountries = holdings
    .filter((r: any) =>
      !String(r.country_name).includes('United States') &&
      !String(r.country_name_cn).includes('美国') &&
      !String(r.country_name).includes('World') &&
      !String(r.country_name).includes('Euro Area') &&
      !String(r.country_name_cn).includes('World') &&
      !String(r.country_name_cn).includes('欧元区')
    )
    .slice(0, 10)
    .map((r: any) => ({
      country: String(r.country_name),
      country_cn: getCnName(r.country_name, r.country_name_cn),
      region: r.region,
      latest_tonnes: Number(r.holding_tonnes),
    }))

  // 3) 获取这些国家所有历史月度变动（gold_reserve_changes）
  //    用最新持有量作为终点，倒推每个历史月份的持有量
  const topNames = topCountries.map(c => c.country)
  const placeholders = topNames.map(() => '?').join(',')
  const changesRaw = await safeQuery(
    `SELECT country_name, country_name_cn, period_date, change_tonnes
     FROM gold_reserve_changes
     WHERE change_tonnes IS NOT NULL
       AND country_name IN (${placeholders})
     ORDER BY period_date ASC`,
    topNames
  )

  // 4) 按国家分组变动数据
  const changesByCountry: Record<string, { period: string; change: number }[]> = {}
  for (const r of changesRaw) {
    const key = String(r.country_name)
    if (!changesByCountry[key]) changesByCountry[key] = []
    changesByCountry[key].push({ period: String(r.period_date), change: Number(r.change_tonnes) || 0 })
  }

  // 5) 收集所有日期（并集）
  const dateSet = new Set<string>()
  for (const arr of Object.values(changesByCountry)) {
    for (const c of arr) dateSet.add(c.period)
  }
  const allPeriods = Array.from(dateSet).sort()

  // 6) 为每个国家倒推历史持有量
  //    算法: history[t] = latest_tonnes - sum(changes[t+1 .. end])
  //    即从最新值减去未来所有变动，得到历史某时点的持有量
  const countryTrends = topCountries.map(c => {
    const changes = changesByCountry[c.country] || []
    const changeMap = new Map<string, number>()
    for (const ch of changes) changeMap.set(ch.period, ch.change)

    // 计算每个日期的累计未来变动
    const values: (number | null)[] = []
    for (const period of allPeriods) {
      const idx = allPeriods.indexOf(period)
      // 从该日期之后到末尾的所有变动之和
      let futureSum = 0
      for (let i = idx + 1; i < allPeriods.length; i++) {
        const ch = changeMap.get(allPeriods[i])
        if (ch != null) futureSum += ch
      }
      const histVal = c.latest_tonnes - futureSum
      values.push(histVal > 0 ? Math.round(histVal * 10) / 10 : null)
    }

    return {
      country: c.country,
      country_cn: c.country_cn,
      region: c.region,
      values,
    }
  })

  // 7) 中国央行月度数据（CNGOLD）— 用于补充中国趋势的细粒度
  const cnIndicatorRaw = await safeQuery(`
    SELECT d.period_date, d.value
    FROM indicator_data d
    JOIN indicators i ON i.id = d.indicator_id
    WHERE i.code = 'CNGOLD'
    ORDER BY d.period_date ASC
    LIMIT 300
  `)

  // 构建 indicator_data 的中国 Map（万盎司 → 吨）
  const cnIndicatorMap = new Map<string, number>()
  cnIndicatorRaw.forEach((r: any) =>
    cnIndicatorMap.set(String(r.period_date), Number(r.value) * OZ_10K_TO_TONNES))

  // 用 indicator_data 补充中国序列中空缺的日期
  const cnTrendIdx = countryTrends.findIndex(c =>
    c.country.includes('China') || c.country_cn.includes('中国'))
  if (cnTrendIdx >= 0) {
    const cnTrend = countryTrends[cnTrendIdx]
    let lastVal = cnTrend.values.find(v => v != null) || 0
    cnTrend.values = cnTrend.values.map((v, i) => {
      const date = allPeriods[i]
      const indVal = cnIndicatorMap.get(date)
      if (indVal != null) return Math.round(indVal * 10) / 10
      if (v != null) { lastVal = v; return v }
      return lastVal > 0 ? Math.round(lastVal * 10) / 10 : null
    })
  }

  // 8) 全球/欧元区汇总数据（用于 Hero 顶部指标卡）
  const globalTotals = await safeQuery(`
    SELECT country_name,
           country_name_cn,
           holding_tonnes,
           share_of_total_reserves,
           period_date
    FROM gold_reserves
    WHERE holding_tonnes IS NOT NULL
      AND country_name IN ('World', 'Euro Area (incl. ECB)', 'Euro Area')
    ORDER BY country_name DESC
    LIMIT 5
  `)

  const latest_holding = holdings.length > 0 ? holdings[0] : null

  const data = {
    period_date: latest_holding ? latest_holding.period_date : null,
    holdings: holdings.map((r: any) => ({
      country: r.country_name,
      country_cn: getCnName(r.country_name, r.country_name_cn),
      region: r.region,
      tonnes: Number(r.holding_tonnes),
      share_pct: r.share_of_total_reserves ? Number(r.share_of_total_reserves) : null,
      period_date: r.period_date,
    })),
    // 全球/欧元区汇总指标
    global_totals: globalTotals.map((r: any) => ({
      country: r.country_name,
      country_cn: getCnName(r.country_name, r.country_name_cn),
      tonnes: Number(r.holding_tonnes),
      share_pct: r.share_of_total_reserves ? Number(r.share_of_total_reserves) : null,
      period_date: r.period_date,
    })),
    // 主流国家黄金储备历史趋势（单位：吨）
    major_countries_trend: {
      periods: allPeriods,
      countries: countryTrends,
    },
    // 保留旧字段兼容（空数组，前端不再使用）
    us_gold_series: [],
    cn_gold_series: [],
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}, 60)
