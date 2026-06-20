export const prerender = false;

import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db';

const PERIOD_MAP: Record<string, number> = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '5Y': 1825,
  '10Y': 3650,
};

export const GET: APIRoute = async ({ params, request }) => {
  const { region, code } = params;
  if (!code || !region) {
    return new Response(JSON.stringify({ success: false, error: 'Missing region or code' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const indicator = await query(
      `SELECT * FROM indicators WHERE code = ? AND region = ? AND is_active = TRUE`,
      [code, region]
    );

    if (indicator.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const period = url.searchParams.get('period') || '10Y';
    const yearly = url.searchParams.get('yearly') === 'true';
    const days = PERIOD_MAP[period] || PERIOD_MAP['10Y'];

    let sql: string;
    let params: any[];

    if (yearly) {
      const freq = indicator[0].frequency;
      const expectedCnt = freq === 'quarterly' ? 4 : freq === 'monthly' ? 12 : 365;
      const selectYear = `SELECT YEAR(period_date) AS period_date, ROUND(AVG(value), 3) AS value, COUNT(*) AS cnt`;
      if (period === 'MAX') {
        sql = `${selectYear} FROM indicator_data WHERE indicator_id = ? GROUP BY YEAR(period_date) ORDER BY period_date ASC`;
        params = [indicator[0].id];
      } else {
        sql = `${selectYear} FROM indicator_data WHERE indicator_id = ? AND period_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY YEAR(period_date) ORDER BY period_date ASC`;
        params = [indicator[0].id, days];
      }
    } else {
      if (period === 'MAX') {
        sql = `SELECT period_date, ROUND(value, 3) AS value FROM indicator_data WHERE indicator_id = ? ORDER BY period_date ASC`;
        params = [indicator[0].id];
      } else {
        sql = `SELECT period_date, ROUND(value, 3) AS value FROM indicator_data WHERE indicator_id = ? AND period_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ORDER BY period_date ASC`;
        params = [indicator[0].id, days];
      }
    }

    let data = await query(sql, params);

    if (yearly) {
      const freq = indicator[0].frequency;
      const expectedCnt = freq === 'quarterly' ? 4 : freq === 'monthly' ? 12 : 365;
      data = data.map((d: any) => ({ ...d, expected_cnt: expectedCnt }));
    }

    const TRIL: Record<string, Record<string, number>> = {
      US: { GDP: 0.001, PCE: 0.001, RSXFS: 0.000001 },
      CN: { GDP: 0.0001, RETAIL: 0.0001 },
    };
    const factor = TRIL[region]?.[code];
    if (factor) {
      data = data.map((d: any) => ({ ...d, value: d.value != null ? Number(d.value) * factor : null }));
    }

    return new Response(
      JSON.stringify({ success: true, indicator: indicator[0], data }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
