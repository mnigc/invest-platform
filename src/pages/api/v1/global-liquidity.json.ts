export const prerender = false;

import { query } from '../../../lib/db';
import { withCache } from '../../../lib/cache';
import { loadSeries } from '../../../lib/series';
import { asOfLookup, yoySeries, mergeByDate } from '../../../lib/seriesMath';
import type {
  GlobalLiquidityResponse,
  LiquiditySeries,
  LiquidityIndicatorCode,
  MoneySupplyPoint,
} from '../../../lib/core';

const CODES: { code: LiquidityIndicatorCode; zh: string; en: string }[] = [
  { code: 'FED_BALANCE_SHEET', zh: '美联储总资产', en: 'Fed Total Assets' },
  { code: 'FED_RRP', zh: '美联储隔夜逆回购', en: 'Fed O/N Reverse Repo' },
  { code: 'FED_TGA', zh: 'TGA账户余额', en: 'Treasury General Account' },
  { code: 'SOFR', zh: '担保隔夜融资利率', en: 'SOFR' },
  { code: 'ECB_BALANCE_SHEET', zh: '欧央行总资产', en: 'ECB Total Assets' },
  { code: 'BOJ_BALANCE_SHEET', zh: '日本央行总资产', en: 'BOJ Total Assets' },
  // 流动性缺口补齐
  { code: 'IORB', zh: '准备金余额利率', en: 'Interest on Reserve Balances' },
  { code: 'BANK_RESERVES', zh: '银行体系准备金', en: 'Reserve Balances with Fed' },
  { code: 'M1', zh: 'M1 货币供应', en: 'M1 Money Stock' },
  { code: 'M2', zh: 'M2 货币供应', en: 'M2 Money Stock' },
];

function ffillMap(points: { date: string; value: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  let last: number | null = null;
  for (const p of points) {
    last = p.value;
    out.set(p.date, last);
  }
  return out;
}

export const GET = withCache(async () => {
  try {
    const results = await Promise.all(CODES.map((c) => loadSeries(c.code)));
    const series: LiquiditySeries[] = CODES.map((c, i) => ({
      code: c.code,
      nameZh: c.zh,
      nameEn: c.en,
      unit: '',
      frequency: '',
      data: results[i].map((p) => ({ date: p.date, value: p.value })),
    }));

    const meta = await query<any>(
      `SELECT i.code, i.unit, i.frequency, max(d.period_date) AS last_update
       FROM indicators i
       LEFT JOIN indicator_data d ON d.indicator_id = i.id
       WHERE i.code IN (${CODES.map(() => '?').join(',')})
       GROUP BY i.code, i.unit, i.frequency`,
      CODES.map((c) => c.code)
    );
    const metaMap = new Map(meta.map((r: any) => [r.code, { unit: r.unit, frequency: r.frequency }]));
    for (const s of series) {
      const m = metaMap.get(s.code);
      if (m) {
        s.unit = m.unit;
        s.frequency = m.frequency;
      }
    }
    const updatedAt = meta
      .map((r: any) => (r.last_update ? String(r.last_update) : null))
      .filter(Boolean)
      .sort()
      .pop();

    // 按 code 取值，不依赖数组下标 —— 后续增删指标时不会因为顺序变动而错位
    const byCode = new Map(results.map((r, i) => [CODES[i].code, r]));
    const pick = (code: LiquidityIndicatorCode) => byCode.get(code) ?? [];

    const fedData = pick('FED_BALANCE_SHEET');
    const rrpData = pick('FED_RRP');
    const tgaData = pick('FED_TGA');
    const sofrData = pick('SOFR');
    const iorbData = pick('IORB');
    const m1Data = pick('M1');
    const m2Data = pick('M2');

    // ── 净流动性 = 美联储总资产 - RRP - TGA ──
    const rrpMap = ffillMap(rrpData);
    const tgaMap = ffillMap(tgaData);

    const netLiquidity: { date: string; value: number }[] = [];
    for (const p of fedData) {
      const rrp = rrpMap.get(p.date);
      const tga = tgaMap.get(p.date);
      if (rrp == null || tga == null) continue;
      netLiquidity.push({
        date: p.date,
        value: +(p.value - rrp - tga).toFixed(2),
      });
    }

    // ── SOFR − IORB 利差（基点）──
    // IORB 是政策利率底，SOFR 是市场实际融资成本。裸看 SOFR 只能看绝对水平，
    // 减去 IORB 才能看出「相对底线是否吃紧」—— 转正是回购市场缺钱的最早期信号。
    const sofrIorbSpread: { date: string; value: number }[] = [];
    for (const p of sofrData) {
      const iorb = asOfLookup(iorbData, p.date);
      if (iorb == null) continue;
      sofrIorbSpread.push({ date: p.date, value: +((p.value - iorb) * 100).toFixed(2) });
    }

    // ── M1 / M2 同比与剪刀差 ──
    const moneySupply: MoneySupplyPoint[] = mergeByDate(
      yoySeries(m1Data),
      yoySeries(m2Data),
    ).map((p) => ({
      date: p.date,
      m1Yoy: p.a,
      m2Yoy: p.b,
      scissors: +(p.a - p.b).toFixed(2),
    }));

    const result: GlobalLiquidityResponse = {
      series,
      updatedAt: updatedAt || new Date().toISOString(),
      netLiquidity,
      sofrIorbSpread,
      moneySupply,
    };

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e.message || '查询失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}, 1800);
