import { REGIME_BG, REGIME_LABELS } from '../../lib/regimeMeta'

// 从 REGIME_BG 派生，新增/删除体制时图例自动跟随（UNKNOWN 不展示底色）
const LEGEND_KEYS = Object.keys(REGIME_BG).filter((k) => k !== 'UNKNOWN')

/** S&P500×宏观体制图的图例说明（首页与详情页共用） */
export function RegimeLegend() {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-3">
      {LEGEND_KEYS.map((key) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: REGIME_BG[key] }} />
          {REGIME_LABELS[key]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 text-ink-3">
        背景色 = 当时判定宏观体制；虚线 = 体制切换点
      </span>
    </div>
  )
}
