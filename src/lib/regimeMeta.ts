export type Dir = -1 | 0 | 1

export const REGIME_LABELS: Record<string, string> = {
  GOLDILOCKS: '金发女孩',
  RISK_ON: '风险偏好',
  OVERHEAT: '过热',
  STAGFLATION: '滞胀',
  RISK_OFF: '风险规避',
  RECOVERY: '复苏',
  UNKNOWN: '不确定',
}

export const REGIME_DIR: Record<string, Dir> = {
  GOLDILOCKS: 1,
  RISK_ON: 1,
  RECOVERY: 1,
  OVERHEAT: 0,
  STAGFLATION: -1,
  RISK_OFF: -1,
  UNKNOWN: 0,
}

export const REGIME_DESC: Record<string, string> = {
  GOLDILOCKS: '经济增长稳健、通胀受控、无系统性压力、收益率曲线正常。风险资产（股票/商品）占优，是理想的投资环境。',
  RISK_ON: '经济增长稳健、通胀受控，但存在一定市场压力。风险资产仍可持有，但需关注压力来源。',
  OVERHEAT: '经济增长强劲但通胀偏高，央行可能收紧政策。关注利率敏感板块，适度防御。',
  STAGFLATION: '增长放缓叠加通胀高企，最棘手的宏观组合。现金和实物资产相对占优，股票承压。',
  RISK_OFF: '经济收缩、市场恐慌，典型的避险环境。国债、黄金、现金为王，远离风险资产。',
  RECOVERY: '经济从底部回升，政策仍偏宽松。关注周期股和新兴市场，逐步增加风险敞口。',
  UNKNOWN: '当前信号不够明确，无法判定单一体制。建议保持均衡配置，等待更多数据确认。',
}

export const REGIME_BG: Record<string, string> = {
  GOLDILOCKS: 'rgba(34,197,94,0.22)',
  RISK_ON: 'rgba(59,130,246,0.22)',
  OVERHEAT: 'rgba(245,158,11,0.25)',
  STAGFLATION: 'rgba(239,68,68,0.28)',
  RISK_OFF: 'rgba(239,68,68,0.28)',
  RECOVERY: 'rgba(6,182,212,0.22)',
  UNKNOWN: 'rgba(156,163,175,0.15)',
}
