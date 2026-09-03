export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';
import type { NowcastResponse } from '../../../lib/core';

/**
 * Nowcast API（亚特兰大 GDPNow / 圣路易斯联储 ENI）。
 *
 * 按用户决策：本接口**不**挂任何页面、不挂导航。
 * 暴露在 `/api/v1/nowcast.json` 供内部看板 / 二次开发调用。
 *
 * 实现说明（v2 修订）：
 *   - gdpNow  → FRED series `GDPNOW`（亚特兰大 Fed GDPNow 季度 SAAR %）
 *   - nyFed   → FRED series `STLENI`（圣路易斯联储 Economic News Index
 *               for Real GDP Nowcast）。**这不是 NY Fed Staff Nowcast 的
 *               直接镜像**，但同属「月度高频数据预测当季 GDP」的方法论家族，
 *               作为第二源对照有意义。
 *   - 原计划里的 NY Fed XLSX 端点实测返回 HTML 落地页（结构变更后未修复），
 *     且 FRED 上没有 NY Fed Staff Nowcast 的镜像；改用 STLENI 是当前最佳替代。
 */
export const GET = withCache(async () => {
  try {
    const rows = await query<any>(
      `SELECT source, snapshot_date, gdp_value
       FROM nowcast_snapshots
       WHERE source IN ('GDPNow', 'NYFed')
         AND gdp_value IS NOT NULL
       ORDER BY source, snapshot_date`,
    );

    const gdpNow: { date: string; value: number | null }[] = [];
    const nyFed: { date: string; value: number | null }[] = [];
    let maxDate: string | null = null;

    for (const r of rows) {
      const d = String(r.snapshot_date).slice(0, 10);
      const v = Number(r.gdp_value);
      const target = r.source === 'GDPNow' ? gdpNow : nyFed;
      target.push({ date: d, value: Number.isFinite(v) ? +v.toFixed(2) : null });
      if (!maxDate || d > maxDate) maxDate = d;
    }

    const result: NowcastResponse = {
      gdpNow,
      nyFed,
      updatedAt: maxDate ? `${maxDate}T00:00:00Z` : new Date().toISOString(),
    };

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e.message || '查询失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}, 1800);