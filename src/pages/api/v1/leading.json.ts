export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';
import { loadSeries } from '../../../lib/series';
import { sahmRule } from '../../../lib/seriesMath';
import type { LeadingResponse, LeadingSeries, LeadingCode, SahmSignal } from '../../../lib/core';

const CODES: { code: LeadingCode; zh: string; en: string }[] = [
  { code: 'NFCI', zh: '芝加哥联储金融状况指数', en: 'Chicago Fed NFCI' },
  { code: 'ICSA', zh: '初请失业金人数', en: 'Initial Claims' },
  { code: 'UNRATE', zh: '失业率', en: 'Unemployment Rate' },
  { code: 'PAYEMS', zh: '非农就业总数', en: 'All Employees Total Nonfarm' },
  { code: 'INDPRO', zh: '工业产出指数', en: 'Industrial Production' },
  { code: 'CAPACITY_UTIL', zh: '产能利用率', en: 'Capacity Utilization' },
  { code: 'PERMIT', zh: '营建许可', en: 'Building Permits' },
  { code: 'CORE_CAPEX_ORDERS', zh: '核心资本品订单', en: 'Core Capital Goods Orders' },
  { code: 'CONSUMER_SENT', zh: '密歇根消费者信心', en: 'UoM Consumer Sentiment' },
];

const SAHM_THRESHOLD = 0.5;

function buildSahmSignal(sahm: { date: string; value: number | null }[]): SahmSignal {
  let latest: number | null = null;
  for (let i = sahm.length - 1; i >= 0; i--) {
    if (sahm[i].value != null) {
      latest = sahm[i].value;
      break;
    }
  }
  if (latest == null) {
    return {
      value: null,
      threshold: SAHM_THRESHOLD,
      triggered: false,
      status: '数据不足，暂无法判定',
    };
  }
  const triggered = latest >= SAHM_THRESHOLD;
  const status = triggered
    ? '衰退信号已触发 — 历史上该规则触发时经济通常已在衰退中'
    : latest >= 0.3
      ? '接近警戒区 — 失业率已开始抬升，需持续跟踪'
      : '安全区 — 就业市场尚未出现衰退特征';
  return { value: latest, threshold: SAHM_THRESHOLD, triggered, status };
}

export const GET = withCache(async () => {
  try {
    const results = await Promise.all(CODES.map((c) => loadSeries(c.code)));

    const series: LeadingSeries[] = CODES.map((c, i) => ({
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

    // ── 派生：Sahm Rule（仅依赖 UNRATE 一条序列）──
    const unrate = results[CODES.findIndex((c) => c.code === 'UNRATE')] ?? [];
    const sahm = sahmRule(unrate);

    const result: LeadingResponse = {
      series,
      updatedAt: updatedAt || new Date().toISOString(),
      sahm,
      sahmSignal: buildSahmSignal(sahm),
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
