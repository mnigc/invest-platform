export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';
import { toDateStr } from '../../../lib/date';
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
    .map((r: any) => ({ date: toDateStr(r.period_date), value: Number(r.value) }))
    .reverse();
}

function ffillMap(points: { date: string; value: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  let last: number | null = null;
  for (const p of points) {
    last = p.value;
    out.set(p.date, last);
  }
  return out;
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

    const meta = await query<any>(
      `SELECT code, unit, frequency, max(updated_at) AS last_update
       FROM indicators
       WHERE code IN (${CODES.map(() => '?').join(',')})
       GROUP BY code, unit, frequency`,
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
    const updatedAt = meta
      .map((r: any) => (r.last_update ? String(r.last_update) : null))
      .filter(Boolean)
      .sort()
      .pop();

    const fedData = results[0];
    const rrpData = results[1];
    const tgaData = results[2];

    const rrpMap = ffillMap(rrpData);
    const tgaMap = ffillMap(tgaData);

    const netLiquidity: { date: string; value: number }[] = [];
    for (const p of fedData) {
      const rrp = rrpMap.get(p.date);
      const tga = tgaMap.get(p.date);
      if (rrp == null || tga == null) continue;
      netLiquidity.push({
        date: p.date,
        value: +(p.value - rrp - tga).toFixed(2),
      });
    }

    const result: GlobalLiquidityResponse = {
      series,
      updatedAt: updatedAt || new Date().toISOString(),
      netLiquidity,
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
}, 1800);
