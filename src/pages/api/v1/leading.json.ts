export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';
import { loadSeries } from '../../../lib/series';
import { sahmRule, yoySeries, asOfLookup } from '../../../lib/seriesMath';
import type {
  LeadingResponse,
  LeadingSeries,
  LeadingCode,
  SahmSignal,
  G7IpPoint,
} from '../../../lib/core';
import type { Point } from '../../../lib/seriesMath';

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
  // G7 工业产出（OECD via FRED；2024-03 后停止更新）
  { code: 'DE_IP', zh: '德国工业产出', en: 'Germany IP' },
  { code: 'JP_IP', zh: '日本工业产出', en: 'Japan IP' },
  { code: 'GB_IP', zh: '英国工业产出', en: 'UK IP' },
  { code: 'CA_IP', zh: '加拿大工业产出', en: 'Canada IP' },
];

const G7_IP_CODES: LeadingCode[] = ['DE_IP', 'JP_IP', 'GB_IP', 'CA_IP'];

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

    // ── 派生：G7 IP 12 月同比等权平均 ──
    // 各国产出索引基期不同（DE=2015、JP=2015、GB=2015、CA=2015），但同比是相对量，
    // 直接相加后除以国家数即可。注意月频索引的国家发布节奏不同，
    // 用「每个日期把有值的国家等权平均」避免数据缺漏国家导致断点。
    const yoyByCode: Record<string, { date: string; value: number | null }[]> = {};
    for (const code of G7_IP_CODES) {
      const idx = CODES.findIndex((c) => c.code === code);
      const points = results[idx] ?? [];
      yoyByCode[code] = yoySeries(points as Point[]);
    }

    // 聚合所有日期
    const dateSet = new Set<string>();
    for (const code of G7_IP_CODES) {
      for (const p of yoyByCode[code]) dateSet.add(p.date);
    }
    const allDates = Array.from(dateSet).sort();
    const g7IpYoy: G7IpPoint[] = allDates.map((d) => {
      const vals: number[] = [];
      for (const code of G7_IP_CODES) {
        const arr = yoyByCode[code];
        const v = asOfLookup(
          (arr.filter((p) => p.value != null) as { date: string; value: number }[]),
          d,
        );
        if (v != null && Number.isFinite(v)) vals.push(v);
      }
      if (!vals.length) return { date: d, value: null, countries: 0 };
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      return { date: d, value: +mean.toFixed(2), countries: vals.length };
    });

    const result: LeadingResponse = {
      series,
      updatedAt: updatedAt || new Date().toISOString(),
      sahm,
      sahmSignal: buildSahmSignal(sahm),
      g7IpYoy,
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
