export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';
import type { CrossBorderFlowResponse, CrossBorderFlowPoint } from '../../../lib/core';

const LOOKBACK_DAYS = 365 * 5;

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

export const GET = withCache(async () => {
  try {
    const [northbound, southbound, usdcny, cn10y, us10y] = await Promise.all([
      loadSeries('NORTHBOUND_FLOW'),
      loadSeries('SOUTHBOUND_FLOW'),
      loadSeries('USDCNY'),
      loadSeries('CN_TREASURY_10Y'),
      loadSeries('DGS10'),
    ]);

    const northMap = new Map(northbound.map((p) => [p.date, p.value]));
    const southMap = new Map(southbound.map((p) => [p.date, p.value]));
    const fxMap = new Map(usdcny.map((p) => [p.date, p.value]));
    const cnMap = new Map(cn10y.map((p) => [p.date, p.value]));
    const usMap = new Map(us10y.map((p) => [p.date, p.value]));

    const allDates = Array.from(new Set([
      ...northMap.keys(),
      ...southMap.keys(),
      ...fxMap.keys(),
      ...cnMap.keys(),
      ...usMap.keys(),
    ])).sort();

    const history: CrossBorderFlowPoint[] = [];
    for (const d of allDates) {
      const cn = cnMap.get(d) ?? null;
      const us = usMap.get(d) ?? null;
      const spread = cn != null && us != null ? +(cn - us).toFixed(4) : null;
      history.push({
        date: d,
        northbound: northMap.get(d) ?? null,
        southbound: southMap.get(d) ?? null,
        usdcnh: fxMap.get(d) ?? null,
        spread,
      });
    }

    if (history.length === 0) {
      const empty: CrossBorderFlowResponse = {
        latestDate: '',
        latest: { northbound: null, southbound: null, usdcnh: null, spread: null },
        history: [],
      };
      return new Response(JSON.stringify({ success: true, data: empty }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const latest = history[history.length - 1];
    const result: CrossBorderFlowResponse = {
      latestDate: latest.date,
      latest: {
        northbound: latest.northbound,
        southbound: latest.southbound,
        usdcnh: latest.usdcnh,
        spread: latest.spread,
      },
      history,
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
