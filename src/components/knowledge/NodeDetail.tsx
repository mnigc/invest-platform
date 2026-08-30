import type { KnowledgeNode } from './KnowledgeCanvas'
import { nodeTypeMeta } from './KnowledgeCanvas'

interface Props {
  node: KnowledgeNode | null
}

export function NodeDetail({ node }: Props) {
  if (!node) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-1 p-4 text-center text-xs text-ink-3">
        <span>点击图谱节点查看详情</span>
        <span className="text-ink-3/80">拖拽节点可调整布局</span>
      </div>
    )
  }

  const meta = nodeTypeMeta[node.type] || nodeTypeMeta.driver

  return (
    <div className="p-3.5">
      <span
        className="inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-semibold tracking-wide"
        style={{ color: meta.color, backgroundColor: meta.bg }}
      >
        {meta.label}
      </span>
      <h3 className="mt-1.5 text-md font-semibold text-ink">{node.label}</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">{node.desc}</p>
    </div>
  )
}
