export const prerender = false;

import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';
import type { CurveShapeAssessment, CurveShape } from '../../../lib/core';

// 美国：FRED DGS 系列（11 个期限）
const US_CODES: Record<string, string> = {
  DGS1MO: '1M',
  DGS3MO: '3M',
  DGS6MO: '6M',
  DGS1: '1Y',
  DGS2: '2Y',
  DGS3: '3Y',
  DGS5: '5Y',
  DGS7: '7Y',
  DGS10: '10Y',
  DGS20: '20Y',
  DGS30: '30Y',
};

// 中国：中债登国债收益率曲线（10 个期限）
// 注意：3M/6M/20Y 需要运行 sync/fetch_cn_bonds.py 后才会在 indicators 表中创建；
// 缺失的 code 会被安全跳过（SQL IN 查询只返回存在的行），不影响已有期限的数据。
const CN_CODES: Record<string, string> = {
  CN_TREASURY_3M: '3M',
  CN_TREASURY_6M: '6M',
  CN_TREASURY_1Y: '1Y',
  CN_TREASURY_2Y: '2Y',
  CN_TREASURY_3Y: '3Y',
  CN_TREASURY_5Y: '5Y',
  CN_TREASURY_7Y: '7Y',
  CN_TREASURY_10Y: '10Y',
  CN_TREASURY_20Y: '20Y',
  CN_TREASURY_30Y: '30Y',
};

interface BondRow {
  code: string;
  name_zh: string;
  maturity: string;
  period_date: string;
  value: number;
}

interface BondSeries {
  code: string;
  name_zh: string;
  maturity: string;
  latest: { date: string; value: number } | null;
  previous: { date: string; value: number } | null;
  change: number | null;
  history: { date: string; value: number }[];
}

interface RegionData {
  latestDate: string;
  series: BondSeries[];
  curveShape?: CurveShapeAssessment | null;
}

interface Output {
  success: boolean;
  data?: {
    US?: RegionData;
    CN?: RegionData;
  };
  error?: string;
}

const MATURITY_ORDER = ['1M', '3M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '20Y', '30Y'];

async function fetchRegion(
  codes: Record<string, string>,
  region: string,
): Promise<RegionData> {
  const codeList = Object.keys(codes);
  const placeholders = codeList.map(() => '?').join(',');

  // 只取最近 500 天的数据，足够计算 change + 250 天 history + 1Y 分位
  // 避免全表扫描返回 14 万行导致响应体过大
  const rawRows = await query<any>(
    `SELECT i.code, i.name_zh, d.period_date, d.value
     FROM indicators i
     JOIN indicator_data d ON d.indicator_id = i.id
     WHERE i.region = ? AND i.code IN (${placeholders})
       AND i.is_active = TRUE
       AND d.value IS NOT NULL
       AND d.period_date >= DATE_SUB(CURDATE(), INTERVAL 500 DAY)
     ORDER BY i.code, d.period_date DESC`,
    [region, ...codeList],
  );

  const rows = rawRows as any[];
  if (!rows || rows.length === 0) {
    return { latestDate: '', series: [], curveShape: null };
  }

  const byCode: Record<string, BondRow[]> = {};
  for (const r of rows) {
    if (!byCode[r.code]) byCode[r.code] = [];
    byCode[r.code].push({
      code: r.code,
      name_zh: r.name_zh,
      maturity: codes[r.code] || r.code,
      period_date: r.period_date,
      value: Number(r.value),
    });
  }

  // 限制 history 长度：只保留最近 N 天，避免响应体过大
  // 前端趋势图通常只显示 1-3 年，250 个交易日足够
  const MAX_HISTORY_POINTS = 250;

  let latestDate = '';
  const series: BondSeries[] = [];
  let spread10y2yHistory: { date: string; spread: number }[] = [];

  for (const code of codeList) {
    const list = byCode[code] || [];
    if (list.length === 0) continue;

    // sorted 升序：最旧 → 最新
    const sorted = [...list].sort(
      (a, b) => new Date(a.period_date).getTime() - new Date(b.period_date).getTime(),
    );
    const latest = sorted[sorted.length - 1];
    const previous = sorted[sorted.length - 2] || null;
    const change = previous ? +(latest.value - previous.value).toFixed(6) : null;

    if (!latestDate || latest.period_date > latestDate) {
      latestDate = latest.period_date;
    }

    // 截取最近 MAX_HISTORY_POINTS 天用于前端展示
    const trimmedHistory = sorted.slice(-MAX_HISTORY_POINTS);

    series.push({
      code,
      name_zh: latest.name_zh,
      maturity: codes[code],
      latest: { date: latest.period_date, value: latest.value },
      previous: previous ? { date: previous.period_date, value: previous.value } : null,
      change,
      history: trimmedHistory.map((d) => ({ date: d.period_date, value: d.value })),
    });
  }

  // 收集 10Y-2Y 利差历史 → 用于曲线形态判定
  const s2y = series.find((s) => s.maturity === '2Y');
  const s10y = series.find((s) => s.maturity === '10Y');
  if (s2y && s10y) {
    const map10y = new Map(s10y.history.map((p) => [p.date, p.value]));
    for (const p of s2y.history) {
      const v10 = map10y.get(p.date);
      if (v10 != null) {
        spread10y2yHistory.push({ date: p.date, spread: +(v10 - p.value).toFixed(6) });
      }
    }
    spread10y2yHistory.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // 按期限排序
  series.sort((a, b) => MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity));

  // 曲线形态判定
  const curveShape = assessCurveShape(spread10y2yHistory);

  return { latestDate, series, curveShape };
}

function percentile(sortedAsc: number[], value: number): number | null {
  if (sortedAsc.length === 0) return null;
  let lessEq = 0;
  for (const v of sortedAsc) {
    if (v <= value) lessEq++;
    else break;
  }
  return (lessEq / sortedAsc.length) * 100;
}

function assessCurveShape(spreadHistory: { date: string; spread: number }[]): CurveShapeAssessment | null {
  if (spreadHistory.length === 0) return null;
  const latest = spreadHistory[spreadHistory.length - 1];
  const latestSpread = latest.spread;
  if (latestSpread == null) return null;

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);

  const oneYearValues = spreadHistory
    .filter((p) => new Date(p.date) >= oneYearAgo)
    .map((p) => p.spread);
  const fiveYearValues = spreadHistory
    .filter((p) => new Date(p.date) >= fiveYearsAgo)
    .map((p) => p.spread);

  const p1y = oneYearValues.length > 0 ? percentile([...oneYearValues].sort((a, b) => a - b), latestSpread) : null;
  const p5y = fiveYearValues.length > 0 ? percentile([...fiveYearValues].sort((a, b) => a - b), latestSpread) : null;

  let shape: CurveShape;
  let label: string;
  let description: string;

  if (latestSpread < 0) {
    shape = 'inverted';
    label = '倒挂';
    description = '10Y-2Y 利差为负，历史经验上通常是经济衰退的前瞻信号';
  } else if (p1y != null && p1y >= 70) {
    shape = 'steepening';
    label = '陡峭化';
    description = '10Y-2Y 利差处于 1 年高位，长端利率相对短端明显走升';
  } else if (p1y != null && p1y <= 30) {
    shape = 'flattening';
    label = '平坦化';
    description = '10Y-2Y 利差处于 1 年低位，曲线趋于平坦';
  } else {
    shape = 'normal';
    label = '正常';
    description = '10Y-2Y 利差处于正常区间，曲线形态健康';
  }

  return {
    shape,
    label,
    description,
    spread10y2y: +latestSpread.toFixed(4),
    spreadPercentile1y: p1y != null ? +p1y.toFixed(1) : null,
    spreadPercentile5y: p5y != null ? +p5y.toFixed(1) : null,
  };
}

export const GET = withCache(async ({ request }) => {
  try {
    const url = new URL(request.url);
    const regionFilter = url.searchParams.get('region');

    const out: Output = { success: true };

    // 并行请求两个区域的数据
    const [usData, cnData] = await Promise.allSettled([
      (!regionFilter || regionFilter === 'US') ? fetchRegion(US_CODES, 'US') : Promise.resolve(undefined),
      (!regionFilter || regionFilter === 'CN') ? fetchRegion(CN_CODES, 'CN') : Promise.resolve(undefined),
    ]);

    if (usData.status === 'fulfilled' && usData.value) {
      out.data = out.data || {};
      out.data.US = usData.value;
    }
    if (cnData.status === 'fulfilled' && cnData.value) {
      out.data = out.data || {};
      out.data.CN = cnData.value;
    }

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=300',
      },
    });
  } catch (e: any) {
    console.error('[Bonds API]', e.message || e);
    const out: Output = { success: false, error: e.message || '查询失败' };
    return new Response(JSON.stringify(out), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}, 300);
