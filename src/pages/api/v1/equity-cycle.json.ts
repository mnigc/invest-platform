export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';
import { toDateStr } from '../../../lib/date';
import { loadSeries } from '../../../lib/series';
import {
  asOfLookup,
  monthEndClose,
  normalizeTo100,
  equalWeightComposite,
} from '../../../lib/seriesMath';
import type {
  EquityCycleResponse,
  EquityCycleComponent,
} from '../../../lib/core';

const SECTOR_ETFS = [
  { code: 'XLI', bucket: 'cyclical' as const, nameZh: '工业精选行业 ETF' },
  { code: 'XLY', bucket: 'cyclical' as const, nameZh: '可选消费精选行业 ETF' },
  { code: 'XLE', bucket: 'cyclical' as const, nameZh: '能源精选行业 ETF' },
  { code: 'XLB', bucket: 'cyclical' as const, nameZh: '原材料精选行业 ETF' },
  { code: 'XLU', bucket: 'defensive' as const, nameZh: '公用事业精选行业 ETF' },
  { code: 'XLP', bucket: 'defensive' as const, nameZh: '必需消费精选行业 ETF' },
];

// ── 价格层辅助 ──
/** 一次查询拉回全部 ETF 近 N 年日线，按 symbol 分组后各自聚合月末收盘 */
async function loadAllEtfMonthly(
  symbols: string[],
  years = 20,
): Promise<Map<string, { date: string; value: number }[]>> {
  // 取近 N 年（默认 20），月频只需要 ~240 个点，比拉全量日线省一个量级
  const since = new Date();
  since.setFullYear(since.getFullYear() - years);
  const sinceStr = since.toISOString().slice(0, 10);

  const rows = await query<any>(
    `SELECT a.symbol, ap.trade_date, ap.close_price
     FROM asset_prices ap
     JOIN assets a ON a.id = ap.asset_id
     WHERE a.symbol = ANY(?)
       AND ap.close_price IS NOT NULL AND ap.close_price > 0
       AND ap.trade_date >= ?
     ORDER BY a.symbol, ap.trade_date ASC`,
    [symbols, sinceStr],
  );

  const bySymbol = new Map<string, { date: string; value: number }[]>();
  for (const r of rows) {
    const sym = String(r.symbol);
    let arr = bySymbol.get(sym);
    if (!arr) {
      arr = [];
      bySymbol.set(sym, arr);
    }
    arr.push({ date: toDateStr(r.trade_date), value: Number(r.close_price) });
  }

  const out = new Map<string, { date: string; value: number }[]>();
  for (const [sym, daily] of bySymbol) out.set(sym, monthEndClose(daily));
  return out;
}

export const GET = withCache(async () => {
  try {
    // ── 1. HY-BBB 利差（基点） + DFII10 ──
    const [bbbSeries, hySeries, realRateSeries] = await Promise.all([
      loadSeries('BAMLC0A4CBBB'),
      loadSeries('BAMLH0A0HYM2'),
      loadSeries('DFII10'),
    ]);

    // HY − BBB，单位 %；转基点。上行 = 信用下沉溢价扩大
    const hyBbbSpread: { date: string; value: number | null }[] = hySeries.map((p) => {
      const bbb = asOfLookup(bbbSeries, p.date);
      if (bbb == null) return { date: p.date, value: null };
      // p.value 与 bbb 都是 % 形式，相减再乘 100 = bp
      return { date: p.date, value: +((p.value - bbb) * 100).toFixed(2) };
    });

    // ── 2. 6 个 ETF 月线 + 周期/防御等权 + 相对强弱 ──
    const monthlyBySymbol = await loadAllEtfMonthly(SECTOR_ETFS.map((e) => e.code));
    const etfMonthly = SECTOR_ETFS.map((e) => ({
      meta: e,
      monthly: monthlyBySymbol.get(e.code) ?? [],
    }));

    const cyclicalRaw = etfMonthly.filter((m) => m.meta.bucket === 'cyclical' && m.monthly.length);
    const defensiveRaw = etfMonthly.filter((m) => m.meta.bucket === 'defensive' && m.monthly.length);

    const cyclicalNorm = cyclicalRaw.map((m) =>
      normalizeTo100(m.monthly).filter(
        (p): p is { date: string; value: number } => p.value != null,
      ),
    );
    const defensiveNorm = defensiveRaw.map((m) =>
      normalizeTo100(m.monthly).filter(
        (p): p is { date: string; value: number } => p.value != null,
      ),
    );

    const cyclicalIndex = equalWeightComposite(cyclicalNorm);
    const defensiveIndex = equalWeightComposite(defensiveNorm);

    const defensiveMap = new Map(defensiveIndex.map((p) => [p.date, p.value]));
    const cyclicalDefensiveRatio: { date: string; value: number | null }[] = cyclicalIndex.map(
      (p) => {
        const d = defensiveMap.get(p.date);
        if (d == null || !d) return { date: p.date, value: null };
        return { date: p.date, value: +(p.value / d).toFixed(4) };
      },
    );

    const cyclicalComponents: EquityCycleComponent[] = etfMonthly
      .filter((m) => m.monthly.length)
      .map((m) => ({
        code: m.meta.code,
        nameZh: m.meta.nameZh,
        bucket: m.meta.bucket,
        data: normalizeTo100(m.monthly),
      }));

    // ── 3. updatedAt 取最晚 ──
    const updatedAt = new Date().toISOString();
    const lastDataDates = [
      ...bbbSeries.map((p) => p.date),
      ...realRateSeries.map((p) => p.date),
      ...cyclicalIndex.map((p) => p.date),
    ].sort();
    const finalUpdatedAt = lastDataDates.length
      ? `${lastDataDates[lastDataDates.length - 1]}T00:00:00Z`
      : updatedAt;

    const result: EquityCycleResponse = {
      hyBbbSpread,
      realRate: realRateSeries.map((p) => ({ date: p.date, value: p.value })),
      cyclicalDefensiveRatio,
      cyclicalComponents,
      updatedAt: finalUpdatedAt,
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