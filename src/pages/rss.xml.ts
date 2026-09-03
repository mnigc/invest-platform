import rss from '@astrojs/rss'
import type { APIContext } from 'astro'

export async function GET(context: APIContext) {
  const site = context.site?.toString() ?? 'https://macroedge.example.com/'
  const pubDate = new Date()

  return rss({
    title: 'MACRO EDGE · 宏观投资研究终端',
    description:
      '黄金 / 流动性 / 信用 / 收益率曲线 / 宏观体制 / 跨资产联动 — 每日更新的宏观研究指标与信号板。',
    site,
    items: [
      {
        title: '组合信号板 · 每日更新',
        pubDate,
        description:
          '黄金价格、宏观体制、风险异常、信用利差、收益率曲线等多源信号加权综合评分。',
        link: '/signal-board',
      },
      {
        title: '黄金决策 · 实际利率 + 美元指数残差信号',
        pubDate,
        description:
          '黄金-美元滚动相关、定价残差 z-score、央行购金、20/60 日动量、事件回测。',
        link: '/signals/gold',
      },
      {
        title: '宏观体制研判 · 六大体制实时判定',
        pubDate,
        description:
          'CFNAI / CPI / 联邦利率 / VIX / 信用利差 / 期限利差六维信号加权，映射到金发女孩/风险偏好/过热/滞胀/风险规避/复苏。',
        link: '/signals/regime',
      },
      {
        title: '全球流动性监测 · 美联储 + 欧央行 + 日央行',
        pubDate,
        description:
          '总资产、RRP、TGA、净流动性、准备金、SOFR vs IORB、M1/M2 剪刀差。',
        link: '/indicators/global-liquidity',
      },
      {
        title: '领先指标与衰退预警 · Sahm Rule + NFCI',
        pubDate,
        description:
          '周频初请失业金、NFCI 金融状况指数；月度失业率、工业产出、营建许可、密歇根信心。',
        link: '/indicators/leading',
      },
    ],
    customData: '<language>zh-CN</language>',
  })
}
