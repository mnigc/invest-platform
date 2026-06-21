export const prerender = false;

import { query } from '../../../../lib/db';
import { withCache } from '../../../../lib/cache';
import type { CnUsSpreadResponse, CnUsSpreadPoint } from '../../../../lib/core';

const LOOKBACK_DAYS = 365 * 5; // 5 年历史

async function loadSeries(code: string): Promise<{ date: string; value: number }[]> {
  const rows = await query<any>(
    `SELECT d.period_date, d.value
     FROM indicator_data d
     JOIN indicators i ON i.id = d.indicator_id
     WHERE i.code = ?
       AND d.value IS NOT NULL
     ORDER BY d.period_date DESC
     LIMIT ?`,
    [code, LOOKBACK_DAYS]
  );
  return rows
    .map((r) => ({ date: String(r.period_date).slice(0, 10), value: Number(r.value) }))
    .reverse();
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

function countInversions(history: CnUsSpreadPoint[]): number {
  // 统计 spread < 0 持续 >= 5 个交易日的倒挂事件次数
  let count = 0;
  let runLen = 0;
  for (const p of history) {
    if (p.spread != null && p.spread < 0) {
      runLen++;
    } else {
      if (runLen >= 5) count++;
      runLen = 0;
    }
  }
  if (runLen >= 5) count++;
  return count;
}

export const GET = withCache(async () => {
  try {
    const [cn10y, us10y] = await Promise.all([
      loadSeries('CN_TREASURY_10Y'),
      loadSeries('DGS10'),
    ]);

    const cnMap = new Map(cn10y.map((p) => [p.date, p.value]));
    const usMap = new Map(us10y.map((p) => [p.date, p.value]));

    // 取两边日期的并集，按日期升序
    const allDates = Array.from(new Set([...cnMap.keys(), ...usMap.keys()])).sort();

    const history: CnUsSpreadPoint[] = [];
    for (const d of allDates) {
      const cn = cnMap.get(d) ?? null;
      const us = usMap.get(d) ?? null;
      // 只保留两边都有数据的日期，确保 spread 可计算
      if (cn != null && us != null) {
        history.push({ date: d, cn10y: cn, us10y: us, spread: +(cn - us).toFixed(4) });
      }
    }

    if (history.length === 0) {
      const empty: CnUsSpreadResponse = {
        latestDate: '',
        latest: { cn10y: null, us10y: null, spread: null, change: null },
        history: [],
        warningLines: [
          { label: '轻度警戒', valueBp: -100 },
          { label: '深度警戒', valueBp: -150 },
        ],
        percentile1y: null,
        percentile5y: null,
        inversionCount: 0,
      };
      return new Response(JSON.stringify({ success: true, data: empty }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const latest = history[history.length - 1];
    const prev = history[history.length - 2];
    const change = prev?.spread != null ? +(latest.spread! - prev.spread).toFixed(4) : null;

    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const fiveYearsAgo = new Date(now);
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);

    const oneYearSpreads = history.filter((p) => new Date(p.date) >= oneYearAgo).map((p) => p.spread!);
    const fiveYearSpreads = history.filter((p) => new Date(p.date) >= fiveYearsAgo).map((p) => p.spread!);

    const p1y = oneYearSpreads.length > 0
      ? +percentile([...oneYearSpreads].sort((a, b) => a - b), latest.spread!)!.toFixed(1)
      : null;
    const p5y = fiveYearSpreads.length > 0
      ? +percentile([...fiveYearSpreads].sort((a, b) => a - b), latest.spread!)!.toFixed(1)
      : null;

    const result: CnUsSpreadResponse = {
      latestDate: latest.date,
      latest: {
        cn10y: latest.cn10y,
        us10y: latest.us10y,
        spread: latest.spread,
        change,
      },
      history,
      warningLines: [
        { label: '轻度警戒', valueBp: -100 },
        { label: '深度警戒', valueBp: -150 },
      ],
      percentile1y: p1y,
      percentile5y: p5y,
      inversionCount: countInversions(history),
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
