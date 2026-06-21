export const prerender = false

import type { APIRoute } from 'astro'
import { query } from '../../../../lib/db'
import { withCache } from '../../../../lib/cache'

async function safeQuery(sql: string, params?: any[]): Promise<any[]> {
  try {
    const rows = await query(sql, params)
    return Array.isArray(rows) ? rows : []
  } catch (err: any) {
    console.error('[gold/changes] safeQuery', err.message)
    return []
  }
}

// 补充中文名映射（修复当前数据库中未识别的名称）
const CN_NAME_MAP: Record<string, string> = {
  'Kyrgyz Rep.': '吉尔吉斯斯坦',
  'Kazakhstan, Rep. of': '哈萨克斯坦',
  'Uzbekistan, Rep. of': '乌兹别克斯坦',
  'Ukraine': '乌克兰',
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
  const raw = await safeQuery(`
    SELECT country_name,
           country_name_cn,
           period_date,
           change_tonnes
    FROM gold_reserve_changes
    WHERE period_date >= DATE_SUB(CURDATE(), INTERVAL 36 MONTH)
      AND change_tonnes IS NOT NULL
    ORDER BY period_date DESC
  `)

  const countryAbsTotal: Record<string, number> = {}
  const countryCn: Record<string, string> = {}
  for (const r of raw) {
    const key = String(r.country_name)
    countryAbsTotal[key] = (countryAbsTotal[key] || 0) + Math.abs(Number(r.change_tonnes) || 0)
    countryCn[key] = getCnName(r.country_name, r.country_name_cn)
  }
  const topCountries = Object.entries(countryAbsTotal)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([k]) => k)
  const countrySet = new Set(topCountries)

  const allPeriods = Array.from(new Set(raw.map(r => String(r.period_date)))).sort()

  const byCountry: Record<string, Record<string, number>> = {}
  for (const r of raw) {
    const key = String(r.country_name)
    if (!countrySet.has(key)) continue
    byCountry[key] = byCountry[key] || {}
    byCountry[key][String(r.period_date)] = Number(r.change_tonnes) || 0
  }

  const series = topCountries.map(country => ({
    country,
    country_cn: countryCn[country] || country,
    values: allPeriods.map(p => byCountry[country]?.[p] ?? 0),
  }))

  const latestPeriod = allPeriods[allPeriods.length - 1] || null
  const latestRows = raw.filter(r => String(r.period_date) === latestPeriod)
  const topBuyers = latestRows
    .filter(r => Number(r.change_tonnes) > 0)
    .sort((a, b) => Number(b.change_tonnes) - Number(a.change_tonnes))
    .slice(0, 10)
    .map(r => ({ country: r.country_name, country_cn: getCnName(r.country_name, r.country_name_cn), tonnes: Number(r.change_tonnes) }))
  const topSellers = latestRows
    .filter(r => Number(r.change_tonnes) < 0)
    .sort((a, b) => Number(a.change_tonnes) - Number(b.change_tonnes))
    .slice(0, 10)
    .map(r => ({ country: r.country_name, country_cn: getCnName(r.country_name, r.country_name_cn), tonnes: Number(r.change_tonnes) }))

  const data = {
    periods: allPeriods,
    latest_period: latestPeriod,
    series,
    top_buyers: topBuyers,
    top_sellers: topSellers,
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}, 60)
