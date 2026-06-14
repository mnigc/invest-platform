import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';

export const GET: APIRoute = async ({ params }) => {
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

    const data = await query(
      `SELECT period_date, value, value_prev, value_yoy, value_mom, is_estimated, data_quality
       FROM indicator_data
       WHERE indicator_id = ?
       ORDER BY period_date DESC
       LIMIT 50`,
      [indicator[0].id]
    );

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
