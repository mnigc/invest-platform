export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';
import { toDateStr } from '../../../lib/date';
import { loadSeries } from '../../../lib/series';
import type { CpiResponse, CpiSeries, CpiCode } from '../../../lib/core';

const CODES: { code: CpiCode; zh: string; en: string }[] = [
  { code: 'CPI', zh: 'CPI（居民消费价格指数）', en: 'Consumer Price Index' },
  { code: 'CPILFESL', zh: '核心 CPI（剔除食品能源）', en: 'Core Consumer Price Index' },
  { code: 'PCEPI', zh: 'PCE（个人消费支出物价）', en: 'PCE Price Index' },
  { code: 'PCEPILFE', zh: '核心 PCE（联储 2% 目标锚）', en: 'Core PCE Price Index' },
  { code: 'PPIACO', zh: 'PPI（生产者价格指数）', en: 'Producer Price Index' },
];

export const GET = withCache(async () => {
  try {
    // 全部为月频指数序列，取全量历史（CPI 自 1947 年起）以呈现完整通胀周期
    const results = await Promise.all(CODES.map((c) => loadSeries(c.code, 36500)));

    const series: CpiSeries[] = CODES.map((c, i) => ({
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
      .map((r: any) => (r.last_update ? toDateStr(r.last_update) : null))
      .filter(Boolean)
      .sort()
      .pop();

    const result: CpiResponse = {
      series,
      updatedAt: updatedAt || new Date().toISOString(),
    };

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[Cpi]', e?.message || e);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}, 1800);
