import { MacroCard } from "../../ui/MacroCard"
import { THEME } from "../../ui/theme"

interface IndexItem { name: string; code: string; value: number; change: number }

const CORE_INDICES: IndexItem[] = [
  { name: "上证指数", code: "000001", value: 3150.45, change: 0.35 },
  { name: "深证成指", code: "399001", value: 10320.10, change: 0.72 },
  { name: "创业板指", code: "399006", value: 1950.28, change: -0.25 },
  { name: "科创50", code: "000688", value: 850.12, change: 0.18 },
  { name: "北证50", code: "899050", value: 720.35, change: -0.42 },
]

export default function CnHeroPanel({ indices }: { indices?: IndexItem[] | null }) {
  const apiMap = new Map((indices || []).map((d: any) => [d.symbol || d.code, d]))

  const items = CORE_INDICES.map(fallback => {
    const api = apiMap.get(fallback.code)
    if (!api || api.price == null || isNaN(api.price)) {
      return fallback
    }
    const change = api.change != null && !isNaN(api.change) ? Number(api.change) : null
    return {
      name: api.name || fallback.name,
      code: fallback.code,
      value: Number(api.price),
      change: change ?? fallback.change,
      hasRealChange: change !== null,
    }
  })

  return (
    <MacroCard title="中国市场概览" variant="elevated">
      <div style={{ fontSize: "10px", color: THEME.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "8px" }}>核心指数</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "8px" }}>
        {items.map((idx: any) => {
          const isUp = idx.change >= 0
          const realChange = idx.hasRealChange !== false
          return (
            <div key={idx.code} style={{
              padding: "10px 12px", background: THEME.bgCard, borderRadius: "10px",
              border: `1px solid ${THEME.borderLight}`, display: "flex", flexDirection: "column", gap: "4px",
            }}>
              <div style={{ marginBottom: "2px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: THEME.textPrimary, fontFamily: THEME.fontMono }}>{idx.name}</div>
                <div style={{ fontSize: "9px", color: THEME.textMuted, marginTop: "1px", fontFamily: THEME.fontMono }}>{idx.code}</div>
              </div>
              <div style={{ fontSize: "18px", fontWeight: 700, fontFamily: THEME.fontMono, color: THEME.textPrimary, lineHeight: 1.2 }}>
                {idx.value != null ? idx.value.toFixed(2) : "--"}
              </div>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: "2px",
                fontSize: "11px", fontWeight: 700, fontFamily: THEME.fontMono,
                color: realChange ? (isUp ? THEME.green : THEME.red) : THEME.textMuted,
                padding: "2px 6px", borderRadius: "4px", alignSelf: "flex-start",
                background: realChange ? (isUp ? "rgba(8,153,129,0.12)" : "rgba(242,54,69,0.12)") : THEME.bgHover,
              }}>
                {realChange ? (isUp ? "↑" : "↓") : "-"} {realChange ? Math.abs(idx.change).toFixed(2) + "%" : "--"}
              </div>
            </div>
          )
        })}
      </div>
    </MacroCard>
  )
}
