import { Hono } from 'hono'
import { query, queryOne } from '../../db/pool.js'
import type { Anomaly, AnomalyResponse } from '@invest/core'

const router = new Hono()

async function latestVal(code: string): Promise<number | null> {
  try {
    const row = await queryOne<any>(
      `SELECT d.value FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = ? AND d.value IS NOT NULL
       ORDER BY d.period_date DESC LIMIT 1`,
      [code]
    )
    return row ? Number(row.value) : null
  } catch { return null }
}

async function valNDaysAgo(code: string, offset: number): Promise<number | null> {
  try {
    const row = await queryOne<any>(
      `SELECT d.value FROM indicator_data d
       JOIN indicators i ON i.id = d.indicator_id
       WHERE i.code = ? AND d.value IS NOT NULL
       ORDER BY d.period_date DESC LIMIT 1 OFFSET ?`,
      [code, offset]
    )
    return row ? Number(row.value) : null
  } catch { return null }
}

async function detectAnomalies(): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = []

  const dgs10 = await latestVal('DGS10')
  const dgs2 = await latestVal('DGS2')
  const vix = await latestVal('VIXCLS')
  const bbb = await latestVal('BAMLC0A4CBBB')
  const cpi = await latestVal('CPI')
  const fedfunds = await latestVal('FEDFUNDS')
  const cfnai = await latestVal('CFNAI')
  const dfii10 = await latestVal('DFII10')
  const t10yie = await latestVal('T10YIE')
  const vixPrev = await valNDaysAgo('VIXCLS', 22)

  const f = (v: number | null, fb: number) => v ?? fb
  const gDgs10 = f(dgs10, 4.3)
  const gDgs2 = f(dgs2, 4.7)
  const gVix = f(vix, 14)
  const gBbb = f(bbb, 1.2)
  const gCpi = f(cpi, 3.0)
  const gFedfunds = f(fedfunds, 5.25)
  const gCfnai = f(cfnai, 0.05)
  const gDfii10 = f(dfii10, 1.8)
  const gT10yie = f(t10yie, 2.2)
  const slope = gDgs10 - gDgs2

  // 1. Deep yield curve inversion
  if (slope < -0.5) {
    anomalies.push({
      id: 'yield-curve-deep-inversion',
      title: '深度收益率曲线倒挂',
      description: '10Y-2Y 利差深度倒挂，历史衰退信号',
      severity: 'high', indicator: 'DGS10, DGS2',
      currentValue: `${slope.toFixed(2)}%`, threshold: '< -0.50%',
    })
  }

  // 2. Credit panic
  if (gBbb > 2.5 && gVix > 25) {
    anomalies.push({
      id: 'credit-panic',
      title: '信用市场恐慌',
      description: '信用利差扩大 + 波动率飙升，系统性压力信号',
      severity: 'critical', indicator: 'BAMLC0A4CBBB, VIXCLS',
      currentValue: `BBB ${gBbb.toFixed(2)}% / VIX ${gVix.toFixed(1)}`,
      threshold: 'BBB > 2.5% & VIX > 25',
    })
  }

  // 3. CPI >> Fed funds
  if (gCpi > 5 && gCpi > gFedfunds) {
    anomalies.push({
      id: 'inflation-out-of-control',
      title: '通胀远超政策利率',
      description: '实际利率深度为负，央行滞后于通胀曲线',
      severity: 'high', indicator: 'CPI, FEDFUNDS',
      currentValue: `CPI ${gCpi.toFixed(1)}% > Fed ${gFedfunds.toFixed(2)}%`,
      threshold: 'CPI > FedFunds',
    })
  }

  // 4. CFNAI recession signal
  if (gCfnai < -0.7) {
    anomalies.push({
      id: 'cfnai-recession',
      title: '经济活动深度收缩',
      description: 'CFNAI 低于 -0.7，经济进入衰退区',
      severity: 'high', indicator: 'CFNAI',
      currentValue: gCfnai.toFixed(3), threshold: '< -0.70',
    })
  }

  // 5. Stagflation
  if (gCfnai < 0 && gCpi > 4) {
    anomalies.push({
      id: 'stagflation-signal',
      title: '滞胀风险',
      description: '经济增长放缓 + 通胀高企，类1970s滞胀情景',
      severity: 'high', indicator: 'CFNAI, CPI',
      currentValue: `CFNAI ${gCfnai.toFixed(3)} / CPI ${gCpi.toFixed(1)}%`,
      threshold: 'CFNAI < 0 & CPI > 4%',
    })
  }

  // 6. TIPS yield high
  if (gDfii10 > 2.5) {
    anomalies.push({
      id: 'real-rate-spike',
      title: '实际利率偏高',
      description: 'TIPS 实际利率超过 2.5%，流动性收紧信号',
      severity: 'medium', indicator: 'DFII10',
      currentValue: `${gDfii10.toFixed(2)}%`, threshold: '> 2.50%',
    })
  }

  // 7. Inflation expectation de-anchoring
  if (gT10yie > 3 && gCpi < 3) {
    anomalies.push({
      id: 'expectation-deanchor',
      title: '通胀预期脱锚',
      description: '盈亏平衡通胀率高于实际CPI，市场预期远超现实',
      severity: 'medium', indicator: 'T10YIE, CPI',
      currentValue: `T10YIE ${gT10yie.toFixed(2)}% / CPI ${gCpi.toFixed(1)}%`,
      threshold: 'T10YIE > 3% & CPI < 3%',
    })
  }

  // 8. VIX spike
  if (gVix > 20 && vixPrev !== null && vixPrev > 0) {
    const vixChange = (gVix - vixPrev) / vixPrev
    if (vixChange > 0.4) {
      anomalies.push({
        id: 'volatility-shock',
        title: '波动率冲击',
        description: `VIX 一月内飙升 ${(vixChange * 100).toFixed(0)}%，市场恐慌情绪急剧升温`,
        severity: 'medium', indicator: 'VIXCLS',
        currentValue: `${gVix.toFixed(1)} (${(vixChange * 100).toFixed(0)}% MoM)`,
        threshold: '月变化 > 40%',
      })
    }
  }

  return anomalies
}

router.get('/anomalies', async (c) => {
  try {
    const anomalies = await detectAnomalies()
    return c.json({
      success: true,
      data: {
        anomalies,
        totalCount: anomalies.length,
        highCount: anomalies.filter(a => a.severity === 'high' || a.severity === 'critical').length,
        updatedAt: new Date().toISOString().slice(0, 10),
      } satisfies AnomalyResponse,
    })
  } catch (err: any) {
    console.error('[Anomaly]', err.message)
    c.status(500)
    return c.json({ success: false, error: err.message })
  }
})

export default router
