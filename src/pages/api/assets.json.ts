import type { APIRoute } from 'astro';
import { query } from '../../lib/db';

export const GET: APIRoute = async () => {
  try {
    const assets = await query(`
      SELECT a.id, a.symbol, a.name_zh, a.name_en, a.sub_category, a.exchange,
             ac.name_zh as category_name, ac.code as category_code,
             s.last_price, s.change_percent, s.volume
      FROM assets a
      JOIN asset_categories ac ON a.category_id = ac.id
      LEFT JOIN asset_snapshots s ON a.id = s.asset_id
      WHERE a.is_active = TRUE
      ORDER BY ac.sort_order, a.id
    `);

    return new Response(JSON.stringify({ success: true, data: assets }), {
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
