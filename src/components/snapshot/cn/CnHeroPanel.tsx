import { MacroCard } from "../../ui/MacroCard"
import { THEME } from "../../ui/theme"

interface IndexItem { name: string; code: string; value: number; change: number }

export default function CnHeroPanel({ indices }: { indices?: IndexItem[] | null }) {
  const hasData = indices && indices.length > 0

  const items: IndexItem[] = hasData
    ? indices!.map((d: any) => ({ name: d.name, code: d.symbol || "", value: d.price, change: d.change }))
    : [
        { name: "上证指数", code: "000001", value: 3150.45, change: 0.35 },
        { name: "深证成指", code: "399001", value: 10320.10, change: 0.72 },
        { name: "创业板指", code: "399006", value: 1950.28, change: -0.25 },
        { name: "风格大盘", code: "399364", value: 4520.18, change: 0.42 },
        { name: "风格小盘", code: "399367", value: 2840.35, change: -0.58 },
      ]

  const cycleStage = "分歧"
  const limitUp = 42; const limitDown = 8; const boardHeight = 4; const breakRate = 38; const firstBoard = 18
  const coreLeader = { name: "中际旭创", code: "300308", boards: 3, concept: "CPO/光模块" }

  return (
    <MacroCard title="中国市场概览" badge={cycleStage} variant="elevated">
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: "20px", alignItems: "start" }}>
        <div>
          <div style={{ fontSize: "10px", color: THEME.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "8px" }}>核心指数 · 市场情绪周期</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
            {items.map(idx => {
              const isUp = idx.change >= 0
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
                    color: isUp ? THEME.green : THEME.red,
                    padding: "2px 6px", borderRadius: "4px", alignSelf: "flex-start",
                    background: isUp ? "rgba(8,153,129,0.12)" : "rgba(242,54,69,0.12)",
                  }}>
                    {isUp ? "↑" : "↓"} {Math.abs(idx.change).toFixed(2)}%
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <div style={{ fontSize: "10px", color: THEME.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "8px" }}>市场情绪周期</div>

          <div style={{
            display: "flex", alignItems: "center", gap: "12px",
            padding: "10px 12px", background: THEME.bgCard, borderRadius: "8px",
            border: `1px solid ${THEME.borderLight}`, marginBottom: "8px",
          }}>
            <span style={{ fontSize: "11px", color: THEME.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>阶段</span>
            <div style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
              {["启动", "主升", "分歧", "退潮"].map((name, i) => (
                <div key={name} style={{
                  display: "flex", alignItems: "center", gap: "4px",
                  fontSize: "11px", color: i === 2 ? "#F59E0B" : THEME.textMuted,
                  fontFamily: THEME.fontMono, fontWeight: i === 2 ? 600 : 400,
                }}>
                  <div style={{
                    width: "6px", height: "6px", borderRadius: "50%",
                    background: i === 2 ? "#F59E0B" : THEME.borderColor,
                    boxShadow: i === 2 ? "0 0 6px rgba(245,158,11,0.6)" : "none",
                  }} />
                  {name}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px", marginBottom: "8px" }}>
            {[
              { label: "涨停", val: limitUp, clr: THEME.green },
              { label: "跌停", val: limitDown, clr: THEME.red },
              { label: "连板", val: boardHeight, clr: THEME.green },
              { label: "炸板率", val: breakRate + "%", clr: THEME.red },
              { label: "首板", val: firstBoard, clr: THEME.green },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", padding: "8px 4px", background: THEME.bgCard, borderRadius: "8px", border: `1px solid ${THEME.borderLight}` }}>
                <span style={{ fontSize: "9px", color: THEME.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{item.label}</span>
                <span style={{ fontSize: "18px", fontWeight: 700, fontFamily: THEME.fontMono, lineHeight: 1, color: item.clr }}>{item.val}</span>
              </div>
            ))}
          </div>

          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 14px", background: THEME.blueDim, borderRadius: "8px",
            border: "1px solid rgba(59,130,246,0.2)",
          }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: THEME.textPrimary }}>{coreLeader.name}</div>
              <div style={{ fontSize: "11px", color: THEME.textMuted, marginTop: "2px", fontFamily: THEME.fontMono }}>{coreLeader.code} · {coreLeader.concept}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: THEME.blue, fontFamily: THEME.fontMono }}>{coreLeader.boards}板</div>
              <div style={{ fontSize: "9px", color: THEME.textMuted, marginTop: "2px" }}>核心龙头</div>
            </div>
          </div>
        </div>
      </div>
    </MacroCard>
  )
}
