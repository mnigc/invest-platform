export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';
import { toDateStr } from '../../../lib/date';
import { loadSeries } from '../../../lib/series';
import { asOfLookup } from '../../../lib/seriesMath';
import type {
  CommodityResponse,
  CommoditySeries,
  CommodityCode,
  CommoditySpreadPoint,
} from '../../../lib/core';

const CODES: { code: CommodityCode; zh: string; en: string }[] = [
  { code: 'WTI', zh: 'WTI 原油', en: 'WTI Crude Oil' },
  { code: 'BRENT', zh: '布伦特原油', en: 'Brent Crude Oil' },
  { code: 'NATGAS', zh: 'Henry Hub 天然气', en: 'Henry Hub Natural Gas' },
  { code: 'COPPER', zh: '全球铜价', en: 'Global Copper Price' },
  { code: 'IRON_ORE', zh: '全球铁矿石价', en: 'Global Iron Ore Price' },
  { code: 'GLOBAL_COMM_IDX', zh: '全球商品综合价格指数', en: 'Global Commodity Price Index' },
];

/**
 * 黄金日线（金油比用）。
 *
 * gold_price_history 按 (source, price_date) 唯一，多个源会覆盖同一天。
 * 这里用 AVG 去重 —— 各源的美元/盎司报价本就高度一致，取均值比硬挑一个源更稳，
 * 也避免了 DISTINCT ON 需要写死源优先级的问题。
 */
async function loadGold(limitDays = 1825): Promise<{ date: string; value: number }[]> {
  const rows = await query<any>(
    `SELECT price_date, AVG(close_price) AS value
     FROM gold_price_history
     WHERE currency = 'USD' AND unit = 'OZ'
       AND source IN ('yfinance', 'gold-api', 'LOCAL-XLSX', 'FRED')
     GROUP BY price_date
     ORDER BY price_date DESC LIMIT ?`,
    [limitDays],
  );
  return rows
    .map((r: any) => ({ date: toDateStr(r.price_date), value: Number(r.value) }))
    .reverse();
}

export const GET = withCache(async () => {
  try {
    const [results, goldData] = await Promise.all([
      Promise.all(CODES.map((c) => loadSeries(c.code))),
      loadGold().catch(() => [] as { date: string; value: number }[]),
    ]);

    const series: CommoditySeries[] = CODES.map((c, i) => ({
      code: c.code,
      nameZh: c.zh,
      nameEn: c.en,
      unit: '',
      frequency: '',
      data: results[i].map((p) => ({ date: p.date, value: p.value })),
    }));

    const meta = await query<any>(
      `SELECT i.code, i.unit, i.frequency, max(d.period_date) AS last_update
       FROM indicators i
       LEFT JOIN indicator_data d ON d.indicator_id = i.id
       WHERE i.code IN (${CODES.map(() => '?').join(',')})
       GROUP BY i.code, i.unit, i.frequency`,
      CODES.map((c) => c.code),
    );
    for (const s of series) {
      const m = meta.find((r: any) => r.code === s.code);
      if (m) {
        s.unit = m.unit;
        s.frequency = m.frequency;
      }
    }
    const updatedAt = meta
      .map((r: any) => (r.last_update ? String(r.last_update) : null))
      .filter(Boolean)
      .sort()
      .pop();

    // ── 派生：布伦特-WTI 价差 + 金油比 ──
    // 两者都以 WTI 的交易日为主轴（WTI 是日频里流动性最好的），
    // 布伦特与黄金用 as-of 查找对齐，避免日期错配造成假跳变。
    const byCode = new Map(results.map((r, i) => [CODES[i].code, r]));
    const wtiData = byCode.get('WTI') ?? [];
    const brentData = byCode.get('BRENT') ?? [];

    const spreads: CommoditySpreadPoint[] = [];
    for (const p of wtiData) {
      const brent = asOfLookup(brentData, p.date);
      const gold = goldData.length ? asOfLookup(goldData, p.date) : null;
      spreads.push({
        date: p.date,
        brentWti: brent == null ? null : +(brent - p.value).toFixed(2),
        goldOilRatio:
          gold == null || !p.value ? null : +(gold / p.value).toFixed(2),
      });
    }

    const result: CommodityResponse = {
      series,
      updatedAt: updatedAt || new Date().toISOString(),
      spreads,
    };

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e.message || '查询失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}, 1800);
