export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';
import type { GlobalLiquidityResponse, LiquiditySeries, LiquidityIndicatorCode } from '../../../lib/core';

const CODES: { code: LiquidityIndicatorCode; zh: string; en: string }[] = [
  { code: 'FED_BALANCE_SHEET', zh: '美联储总资产', en: 'Fed Total Assets' },
  { code: 'FED_RRP', zh: '美联储隔夜逆回购', en: 'Fed O/N Reverse Repo' },
  { code: 'FED_TGA', zh: 'TGA账户余额', en: 'Treasury General Account' },
  { code: 'SOFR', zh: '担保隔夜融资利率', en: 'SOFR' },
  { code: 'ECB_BALANCE_SHEET', zh: '欧央行总资产', en: 'ECB Total Assets' },
  { code: 'BOJ_BALANCE_SHEET', zh: '日本央行总资产', en: 'BOJ Total Assets' },
];

async function loadSeries(code: string, limitDays = 1825): Promise<{ date: string; value: number }[]> {
  const rows = await query<any>(
    `SELECT d.period_date, d.value
     FROM indicator_data d
     JOIN indicators i ON i.id = d.indicator_id
     WHERE i.code = ? AND d.value IS NOT NULL
     ORDER BY d.period_date DESC LIMIT ?`,
    [code, limitDays]
  );
  return rows
    .map((r: any) => ({ date: String(r.period_date).slice(0, 10), value: Number(r.value) }))
    .reverse();
}

export const GET = withCache(async () => {
  try {
    const results = await Promise.all(CODES.map((c) => loadSeries(c.code)));
    const series: LiquiditySeries[] = CODES.map((c, i) => ({
      code: c.code,
      nameZh: c.zh,
      nameEn: c.en,
      unit: '',
      frequency: '',
      data: results[i].map((p) => ({ date: p.date, value: p.value })),
    }));

    // Fetch units/frequency from indicators table
    const meta = await query<any>(
      `SELECT code, unit, frequency FROM indicators WHERE code IN (${CODES.map(() => '?').join(',')})`,
      CODES.map((c) => c.code)
    );
    const metaMap = new Map(meta.map((r: any) => [r.code, { unit: r.unit, frequency: r.frequency }]));
    for (const s of series) {
      const m = metaMap.get(s.code);
      if (m) {
        s.unit = m.unit;
        s.frequency = m.frequency;
      }
    }

    const result: GlobalLiquidityResponse = {
      series,
      updatedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e.message || '查询失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}, 600);
