import { useMemo, useCallback } from 'react'
import ReactFlow, {
  Background, Controls, MarkerType,
  type Node, type Edge, type NodeTypes,
} from 'reactflow'
import 'reactflow/dist/style.css'

export interface KnowledgeNode {
  id: string
  label: string
  type: 'driver' | 'signal' | 'response' | 'asset' | 'market' | 'regime' | 'structural' | 'case' | 'cross'
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
  height?: number
  onSelect?: (node: KnowledgeNode | null) => void
  selected?: string | null
}

const TYPE_STYLE: Record<KnowledgeNode['type'], { color: string; bg: string; label: string }> = {
  driver: { color: '#f5a623', bg: 'rgba(245,166,35,0.14)', label: '驱动因素' },
  signal: { color: '#06b6d4', bg: 'rgba(6,182,212,0.14)', label: '观察信号' },
  response: { color: '#3b82f6', bg: 'rgba(59,130,246,0.14)', label: '政策响应' },
  asset: { color: '#FF3B30', bg: 'rgba(255,59,48,0.14)', label: '资产' },
  market: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.14)', label: '市场含义' },
  regime: { color: '#00C853', bg: 'rgba(0,200,83,0.14)', label: '宏观状态' },
  structural: { color: '#94a3b8', bg: 'rgba(148,163,184,0.14)', label: '结构机制' },
  case: { color: '#e879f9', bg: 'rgba(232,121,249,0.14)', label: '历史案例' },
  cross: { color: '#f59e0b', bg: 'rgba(245,158,11,0.14)', label: '跨市场' },
}

function buildLayout(raw: KnowledgeNode[]): { x: number; y: number }[] {
  const n = raw.length
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

export function KnowledgeCanvas({ nodes, edges, height = 620, onSelect, selected }: TopicGraphProps) {
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
        style: {
          minWidth: 120,
          padding: '10px 14px',
          borderRadius: 6,
          border: isSel ? `2px solid ${style.color}` : '1px solid var(--border-subtle)',
          background: isSel ? style.bg : 'var(--bg-card)',
          boxShadow: isSel
            ? `0 0 0 3px ${style.color}40, 0 4px 12px rgba(0,0,0,0.4)`
            : '0 2px 6px rgba(0,0,0,0.2)',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
        },
        sourcePosition: 'right',
        targetPosition: 'left',
      }
    })
  }, [nodes, selected])

  const reactEdges: Edge[] = useMemo(() => {
    return edges.map((e, i) => ({
      id: `e${i}`,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: true,
      style: { stroke: 'rgba(120,140,180,0.4)', strokeWidth: 1.5 },
      labelStyle: { fill: 'var(--text-muted)', fontSize: 10 },
      labelBgStyle: { fill: 'var(--bg-card)', fillOpacity: 0.9 },
      markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(120,140,180,0.6)', width: 14, height: 14 },
    }))
  }, [edges])

  const onNodeClick = useCallback((_: any, node: Node) => {
    const found = nodes.find(n => n.id === node.id)
    if (found && onSelect) onSelect(found)
  }, [nodes, onSelect])

  return (
    <div style={{ width: '100%', height, borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
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
        proOptions={{ hideAttribution: true }}
      >
        <Background color="rgba(128,140,180,0.08)" gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export const nodeTypeMeta = TYPE_STYLE
