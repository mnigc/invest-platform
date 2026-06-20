export const prerender = false;

import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';

const PERIOD_MAP: Record<string, number> = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '5Y': 1825,
  '10Y': 3650,
};

export const GET: APIRoute = async ({ params, request }) => {
  const { code } = params;
  if (!code) {
    return new Response(JSON.stringify({ success: false, error: 'Missing code' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const indicator = await query(
      `SELECT * FROM indicators WHERE code = ? AND is_active = TRUE`,
      [code]
    );

    if (indicator.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const period = url.searchParams.get('period') || '10Y';
    const days = PERIOD_MAP[period] || PERIOD_MAP['10Y'];

    let sql: string;
    let params: any[];

    if (period === 'MAX') {
      sql = `SELECT period_date, value FROM indicator_data WHERE indicator_id = ? ORDER BY period_date ASC`;
      params = [indicator[0].id];
    } else {
      sql = `SELECT period_date, value FROM indicator_data WHERE indicator_id = ? AND period_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ORDER BY period_date ASC`;
      params = [indicator[0].id, days];
    }

    const data = await query(sql, params);

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
