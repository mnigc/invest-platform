import { useMemo, useCallback } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Position,
  type Node,
  type Edge,
} from 'reactflow'
import 'reactflow/dist/style.css'

export interface KnowledgeNode {
  id: string
  label: string
  type:
    | 'driver'
    | 'signal'
    | 'response'
    | 'asset'
    | 'market'
    | 'regime'
    | 'structural'
    | 'case'
    | 'cross'
  desc: string
}

export interface KnowledgeEdge {
  source: string
  target: string
  label: string
}

export interface TopicGraphProps {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  onSelect?: (node: KnowledgeNode | null) => void
  selected?: string | null
}

/** 节点类型配色属于领域语义（不随明暗主题切换），故保留固定值 */
const TYPE_STYLE: Record<KnowledgeNode['type'], { color: string; bg: string; label: string }> = {
  driver: { color: '#f5a623', bg: 'rgba(245,166,35,0.16)', label: '驱动因素' },
  signal: { color: '#06b6d4', bg: 'rgba(6,182,212,0.16)', label: '观察信号' },
  response: { color: '#3b82f6', bg: 'rgba(59,130,246,0.16)', label: '政策响应' },
  asset: { color: '#FF3B30', bg: 'rgba(255,59,48,0.16)', label: '资产' },
  market: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.16)', label: '市场含义' },
  regime: { color: '#00C853', bg: 'rgba(0,200,83,0.16)', label: '宏观状态' },
  structural: { color: '#94a3b8', bg: 'rgba(148,163,184,0.16)', label: '结构机制' },
  case: { color: '#e879f9', bg: 'rgba(232,121,249,0.16)', label: '历史案例' },
  cross: { color: '#f59e0b', bg: 'rgba(245,158,11,0.16)', label: '跨市场' },
}

function buildLayout(raw: KnowledgeNode[]): { x: number; y: number }[] {
  const n = raw.length || 1
  const width = 1160
  const height = 640
  return raw.map((_, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2
    return {
      x: width / 2 + Math.cos(angle) * (width / 2 - 140),
      y: height / 2 + Math.sin(angle) * (height / 2 - 110),
    }
  })
}

export function KnowledgeCanvas({ nodes, edges, onSelect, selected }: TopicGraphProps) {
  const reactNodes: Node[] = useMemo(() => {
    const pos = buildLayout(nodes)
    return nodes.map((n, i) => {
      const style = TYPE_STYLE[n.type] || TYPE_STYLE.driver
      const isSel = selected === n.id
      return {
        id: n.id,
        position: pos[i],
        data: { label: n.label, typeLabel: style.label },
        draggable: true,
        selectable: true,
        // ReactFlow 渲染的是 DOM 节点，因此可以直接用 CSS 变量跟随主题
        style: {
          minWidth: 116,
          padding: '10px 14px',
          borderRadius: 6,
          border: `1px solid ${isSel ? style.color : 'rgb(var(--c-border))'}`,
          background: isSel ? style.bg : 'rgb(var(--c-surface))',
          boxShadow: isSel ? `0 0 0 2px ${style.color}55` : '0 1px 2px rgba(0,0,0,0.35)',
          fontSize: 12,
          fontWeight: 600,
          color: 'rgb(var(--c-text))',
          cursor: 'pointer',
          transition:
            'border-color var(--dur-1) var(--ease), background-color var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease)',
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      }
    })
  }, [nodes, selected])

  const reactEdges: Edge[] = useMemo(
    () =>
      edges.map((e, i) => ({
        id: `e${i}`,
        source: e.source,
        target: e.target,
        label: e.label,
        // 原先 animated:true 会让所有连线持续跑 stroke-dashoffset 动画，
        // 节点一多就是常驻重绘。这里改为静态连线。
        animated: false,
        style: { stroke: 'rgb(var(--c-border-strong))', strokeWidth: 1.5 },
        labelStyle: { fill: 'rgb(var(--c-text-3))', fontSize: 10 },
        labelBgStyle: { fill: 'rgb(var(--c-surface))', fillOpacity: 0.92 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: 'rgb(var(--c-border-strong))',
          width: 14,
          height: 14,
        },
      })),
    [edges],
  )

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      const found = nodes.find((n) => n.id === node.id)
      if (found && onSelect) onSelect(found)
    },
    [nodes, onSelect],
  )

  return (
    <div className="h-[280px] w-full overflow-hidden rounded-lg border border-line bg-surface sm:h-[420px] lg:h-[620px]">
      <ReactFlow
        nodes={reactNodes}
        edges={reactEdges}
        onNodeClick={onNodeClick}
        onPaneClick={() => onSelect?.(null)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={1.6}
        nodesConnectable={false}
        nodesDraggable
        nodesFocusable
        edgesFocusable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="rgb(var(--c-border))" gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export const nodeTypeMeta = TYPE_STYLE
