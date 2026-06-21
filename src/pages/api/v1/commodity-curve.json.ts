export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';

const COMMODITY_INFO: Record<string, { name_cn: string }> = {
  CL: { name_cn: 'WTI原油' },
  NG: { name_cn: '天然气' },
  HG: { name_cn: '铜' },
  GC: { name_cn: '黄金' },
  C: { name_cn: '玉米' },
  W: { name_cn: '小麦' },
  S: { name_cn: '大豆' },
};

export const GET = withCache(async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const filter = url.searchParams.get('commodity')?.toUpperCase();

    // 获取最新同步日期
    const lastDateRow = await query<any>('SELECT MAX(snapshot_date) as d FROM commodity_curves');
    const lastDate = lastDateRow?.[0]?.d;
    if (!lastDate) {
      return new Response(JSON.stringify({ success: false, error: '暂无商品期限结构数据，请先运行同步脚本' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    // 获取前一交易日日期，用于日变动计算
    const prevDateRow = await query<any>(
      'SELECT DISTINCT snapshot_date FROM commodity_curves WHERE snapshot_date < ? ORDER BY snapshot_date DESC LIMIT 1',
      [lastDate]
    );
    const prevDate = prevDateRow?.[0]?.snapshot_date || lastDate;

    // 查询最新曲线
    const rows = await query<any>(
      `SELECT commodity, contract, month_label, price, snapshot_date
       FROM commodity_curves
       WHERE snapshot_date = ?
       ORDER BY commodity, month_label`,
      [lastDate]
    );

    // 查询前一日的价格（用于计算 change）
    const prevRows = await query<any>(
      `SELECT commodity, contract, price
       FROM commodity_curves
       WHERE snapshot_date = ?
         AND price IS NOT NULL`,
      [prevDate]
    );
    const prevMap = new Map<string, number>();
    for (const r of prevRows) {
      prevMap.set(r.commodity + '|' + r.contract, Number(r.price));
    }

    // 按商品组织数据
    const commodities: Record<string, any> = {};
    for (const r of rows) {
      const c = r.commodity;
      if (filter && c !== filter) continue;
      if (!commodities[c]) {
        commodities[c] = { code: c, ...COMMODITY_INFO[c] || { name_cn: c }, curve: [] };
      }
      const price = r.price != null ? Number(r.price) : null;
      const prevPrice = prevMap.get(c + '|' + r.contract);
      const change = price != null && prevPrice != null && prevPrice > 0
        ? +((price - prevPrice) / prevPrice * 100).toFixed(2)
        : null;
      commodities[c].curve.push({
        contract: r.contract,
        month: r.month_label,
        price,
        change,
      });
    }

    // 计算各项指标
    for (const c of Object.keys(commodities)) {
      const curve = commodities[c].curve;
      const validPoints = curve.filter((p: any) => p.price != null);

      // 前月价格（第一个有效点）
      const front = validPoints[0] || null;
      commodities[c].frontPrice = front?.price ?? null;

      // 日变动（前月的 change）
      commodities[c].frontChange = front?.change ?? null;

      // 近远月价差 spread = 最近月价格 - 最远月价格 (bp 或 %)
      const last = validPoints.length > 1 ? validPoints[validPoints.length - 1] : null;
      commodities[c].spread = front && last && front.price != null && last.price != null
        ? +((front.price - last.price) / last.price * 100).toFixed(2)
        : null;

      // contango (true=远月升水, false=远月贴水)
      commodities[c].contango = commodities[c].spread != null ? commodities[c].spread < 0 : null;

      commodities[c].updatedAt = lastDate;
    }

    return new Response(JSON.stringify({ success: true, data: { commodities, date: lastDate } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message || '获取失败' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}, 300);
