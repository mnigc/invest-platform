export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';

export const GET = withCache(async () => {
  try {
    const rows = await query<any>(
      `SELECT industries_json, date FROM cn_valuation ORDER BY date DESC LIMIT 1`
    );
    if (rows.length === 0) {
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const industries = JSON.parse(rows[0].industries_json || '[]');
    return new Response(JSON.stringify({
      success: true,
      data: industries,
      date: rows[0].date,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}, 600);
