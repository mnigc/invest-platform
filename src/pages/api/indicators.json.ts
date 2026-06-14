import type { APIRoute } from 'astro';
import { query } from '../../lib/db';

export const GET: APIRoute = async () => {
  try {
    const indicators = await query(`
      SELECT id, code, name_zh, name_en, category, sub_category, unit, frequency, source
      FROM indicators
      WHERE is_active = TRUE
      ORDER BY category, sub_category, id
    `);

    return new Response(JSON.stringify({ success: true, data: indicators }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
