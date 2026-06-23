export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';

const PMI_CODES = ['US_ISM_PMI', 'CN_CAIXIN_PMI', 'CN_NON_MANU_PMI'];

const PMI_META: Record<string, { name_zh: string; name_en: string; region: string; source: string }> = {
  US_ISM_PMI:       { name_zh: '美国ISM制造业PMI',   name_en: 'US ISM Manufacturing PMI',       region: 'US', source: 'ISM' },
  CN_CAIXIN_PMI:    { name_zh: '中国财新制造业PMI',   name_en: 'China Caixin Manufacturing PMI',  region: 'CN', source: 'Caixin' },
  CN_NON_MANU_PMI:  { name_zh: '中国非制造业PMI',    name_en: 'China Non-manufacturing PMI',     region: 'CN', source: 'NBS' },
};

export const GET = withCache(async () => {
  try {
    const placeholders = PMI_CODES.map(() => '?').join(',');
    const indicators = await query<any>(
      `SELECT id, code, name_zh FROM indicators WHERE code IN (${placeholders}) AND is_active = 1`,
      PMI_CODES
    );

    const idMap = new Map(indicators.map((r: any) => [r.code, r.id]));
    const result: Record<string, any> = {};

    for (const code of PMI_CODES) {
      const id = idMap.get(code);
      const meta = PMI_META[code];
      if (!id) {
        result[code] = { ...meta, latest: null, history: [] };
        continue;
      }

      const rows = await query<any>(
        `SELECT period_date, ROUND(value, 1) AS value FROM indicator_data WHERE indicator_id = ? ORDER BY period_date ASC`,
        [id]
      );

      const history = rows.map((r: any) => ({
        date: String(r.period_date).slice(0, 10),
        value: Number(r.value),
      }));

      const latest = history.length > 0 ? history[history.length - 1] : null;
      const prev = history.length > 1 ? history[history.length - 2] : null;
      const change = latest && prev ? +(latest.value - prev.value).toFixed(1) : null;

      result[code] = { ...meta, latest, change, history };
    }

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
