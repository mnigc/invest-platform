export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';
import { toDateStr } from '../../../lib/date';
import type { NowcastResponse } from '../../../lib/core';

/**
 * Nowcast API（亚特兰大 GDPNow / 圣路易斯联储 ENI）。
 *
 * 消费方：宏观共识页（/analysis/macro-consensus）的 NowcastCard；
 * 同时保留裸 JSON 端点供二次开发调用。
 * （历史备注：早期决策曾「不挂任何页面」，2026-09 全盘评审后改为接入共识页，
 * 避免同步任务产出无人消费。）
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
      // snapshot_date 是 date 列，驱动返回 Date 对象；String(Date).slice 会得到
      // "Wed Sep 17" 这类损坏值，必须走 toDateStr
      const d = toDateStr(r.snapshot_date);
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
    console.error('[Nowcast]', e?.message || e);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}, 1800);