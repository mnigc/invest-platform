import { useMemo } from 'react'
import {
  nodeTypeMeta,
  useNodeTypePalette,
  type KnowledgeEdge,
  type KnowledgeNode,
} from './graph'

interface Props {
  node: KnowledgeNode | null
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  onSelect: (node: KnowledgeNode | null) => void
}

export function NodeDetail({ node, nodes, edges, onSelect }: Props) {
  const palette = useNodeTypePalette()
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const incoming = useMemo(
    () => (node ? edges.filter((e) => e.target === node.id) : []),
    [edges, node],
  )
  const outgoing = useMemo(
    () => (node ? edges.filter((e) => e.source === node.id) : []),
    [edges, node],
  )

  if (!node) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 p-4 text-center">
        <svg
          className="h-6 w-6 text-ink-3/60"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="5.5" cy="12" r="2.5" />
          <circle cx="18.5" cy="6" r="2.5" />
          <circle cx="18.5" cy="18" r="2.5" />
          <path d="M8 11l7.8-4M8 13l7.8 4" />
        </svg>
        <p className="text-xs font-medium text-ink-2">点击图谱中的任意节点</p>
        <ul className="space-y-0.5 text-2xs leading-relaxed text-ink-3">
          <li>这里会显示它的解释，以及上下游关联节点</li>
          <li>节点颜色 = 类型，可用画布顶部图例筛选</li>
          <li>拖拽节点整理布局 · 滚轮 / 双指缩放</li>
        </ul>
      </div>
    )
  }

  const meta = nodeTypeMeta(node.type)
  const p = palette[node.type] ?? palette.driver

  const renderList = (list: KnowledgeEdge[], pick: (e: KnowledgeEdge) => string) =>
    list.map((e) => {
      const related = byId.get(pick(e))
      if (!related) return null
      const rp = palette[related.type] ?? palette.driver
      return (
        <li key={`${e.source}-${e.target}`}>
          <button
            type="button"
            onClick={() => onSelect(related)}
            title={`查看「${related.label}」`}
            className="group flex w-full items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-left transition-colors duration-1 ease-terminal hover:border-line-strong hover:bg-surface-3"
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: rp.color }}
              aria-hidden="true"
            />
            <span className="truncate text-xs font-medium text-ink-2 group-hover:text-ink">
              {related.label}
            </span>
            <span className="ml-auto shrink-0 truncate text-2xs text-ink-3">{e.label}</span>
          </button>
        </li>
      )
    })

  return (
    <div className="p-3.5">
      <div className="flex items-start justify-between gap-2">
        <span
          className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-2xs font-semibold tracking-wide"
          style={{ color: p.color, backgroundColor: p.bg }}
        >
          {meta.label}
        </span>
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-label="取消选中"
          className="shrink-0 rounded p-0.5 text-ink-3 transition-colors duration-1 ease-terminal hover:text-ink"
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <h3 className="mt-1.5 text-md font-semibold text-ink">{node.label}</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">{node.desc}</p>

      {incoming.length > 0 && (
        <section className="mt-3 border-t border-line pt-2.5">
          <h4 className="text-2xs font-semibold uppercase tracking-wider text-ink-3">
            上游 · 谁驱动它
          </h4>
          <ul className="mt-1.5 space-y-1">{renderList(incoming, (e) => e.source)}</ul>
        </section>
      )}
      {outgoing.length > 0 && (
        <section className="mt-3 border-t border-line pt-2.5">
          <h4 className="text-2xs font-semibold uppercase tracking-wider text-ink-3">
            下游 · 它影响谁
          </h4>
          <ul className="mt-1.5 space-y-1">{renderList(outgoing, (e) => e.target)}</ul>
        </section>
      )}
    </div>
  )
}
