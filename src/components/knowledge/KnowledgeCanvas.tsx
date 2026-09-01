import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from 'reactflow'
import 'reactflow/dist/style.css'
import {
  NODE_TYPES,
  nodeTypeMeta,
  typeColorOf,
  useNodeTypePalette,
  type KnowledgeEdge,
  type KnowledgeNode,
  type KnowledgeNodeType,
} from './graph'

export interface TopicGraphProps {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  onSelect?: (node: KnowledgeNode | null) => void
  selected?: string | null
}

/* ---------- 布局：分层流程图（左→右） ----------
 * 1) 最长路径分层（Kahn 拓扑）；
 * 2) 遇到环（债务-通缩螺旋等）时，从数据顺序中最后一个「闭环边」开始逐条剔除
 *    （仅影响分层，连线照常绘制），用最少的断环次数让图重新可分层；
 * 3) 层内用重心法（Barycenter）正反交替 3 轮排序，减少连线交叉；
 * 4) 方向自适应：因果链天然是「宽扁」的，横向铺开会被 fitView 缩得很小，
 *    所以当层数明显多于层内节点数时改为自上而下排布，让图撑满画布、文字更易读。
 *    孤立节点自然落入首层。 */
export interface LayeredLayout {
  positions: Map<string, { x: number; y: number }>
  vertical: boolean
}

function computeLayeredLayout(nodes: KnowledgeNode[], edges: KnowledgeEdge[]): LayeredLayout {
  const ids = nodes.map((n) => n.id)
  const idSet = new Set(ids)
  const valid = edges.filter(
    (e) => idSet.has(e.source) && idSet.has(e.target) && e.source !== e.target,
  )
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]))
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]))
  const link = (list: Map<string, string[]>, from: string, to: string) => {
    const arr = list.get(from)!
    if (!arr.includes(to)) arr.push(to)
  }

  let active = [...valid]
  let layer = new Map<string, number>()
  let processed = new Set<string>()

  const runKahn = () => {
    preds.clear()
    succs.clear()
    ids.forEach((id) => {
      preds.set(id, [])
      succs.set(id, [])
    })
    for (const e of active) {
      link(succs, e.source, e.target)
      link(preds, e.target, e.source)
    }
    layer = new Map()
    processed = new Set()
    const inDeg = new Map<string, number>(ids.map((id) => [id, preds.get(id)!.length]))
    const queue: string[] = ids.filter((id) => inDeg.get(id) === 0)
    const drain = (v: string) => {
      let lv = 0
      for (const p of preds.get(v)!) lv = Math.max(lv, (layer.get(p) ?? 0) + 1)
      layer.set(v, lv)
      processed.add(v)
      for (const u of succs.get(v)!) {
        inDeg.set(u, inDeg.get(u)! - 1)
        if (inDeg.get(u) === 0) queue.push(u)
      }
    }
    while (queue.length > 0) {
      const v = queue.shift()!
      if (!processed.has(v)) drain(v)
    }
  }

  runKahn()
  // 断环：剔除「环内节点之间」的最后一条边，直到全部可分层
  for (let guard = 0; ids.some((id) => !processed.has(id)) && guard < valid.length; guard++) {
    const cyclic = active.filter((e) => !processed.has(e.source) && !processed.has(e.target))
    if (cyclic.length === 0) break
    active = active.filter((e) => e !== cyclic[cyclic.length - 1])
    runKahn()
  }

  // 层内排序：重心法
  const rows: string[][] = []
  const maxL = Math.max(0, ...[...layer.values()])
  for (let l = 0; l <= maxL; l++) rows.push(ids.filter((id) => layer.get(id) === l))
  const order = new Map<string, number>()
  rows.forEach((row) => row.forEach((id, i) => order.set(id, i)))
  const bary = (id: string, nbrs: Map<string, string[]>) => {
    const ns = nbrs.get(id)!.filter((x) => order.has(x))
    if (ns.length === 0) return Number.MAX_SAFE_INTEGER
    return ns.reduce((s, x) => s + order.get(x)!, 0) / ns.length
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let l = 1; l < rows.length; l++) {
      rows[l].sort((a, b) => bary(a, preds) - bary(b, preds) || order.get(a)! - order.get(b)!)
      rows[l].forEach((id, i) => order.set(id, i))
    }
    for (let l = rows.length - 2; l >= 0; l--) {
      rows[l].sort((a, b) => bary(a, succs) - bary(b, succs) || order.get(a)! - order.get(b)!)
      rows[l].forEach((id, i) => order.set(id, i))
    }
  }

  // 方向自适应：横向时一层一列，纵向时一层一行。
  // 横向图宽 = 层数 * 列宽，纵向图高 = 层数 * 行高；
  // 当横向展开明显比纵向更「扁长」时（因果链常态），改用纵向，
  // 这样 fitView 的缩放比由更充裕的画布高度决定，节点文字更大。
  const H_COL_W = 240
  const H_ROW_H = 96
  const V_COL_W = 232
  const V_ROW_H = 118
  const maxRowSize = Math.max(1, ...rows.map((r) => r.length))
  const vertical = rows.length * H_COL_W > maxRowSize * H_ROW_H * 1.8

  const pos = new Map<string, { x: number; y: number }>()
  if (vertical) {
    rows.forEach((row, layerIdx) => {
      const span = (row.length - 1) * V_COL_W
      row.forEach((id, i) => pos.set(id, { x: i * V_COL_W - span / 2, y: layerIdx * V_ROW_H }))
    })
  } else {
    rows.forEach((row, col) => {
      const span = (row.length - 1) * H_ROW_H
      row.forEach((id, i) => pos.set(id, { x: col * H_COL_W, y: i * H_ROW_H - span / 2 - 16 }))
    })
  }
  return { positions: pos, vertical }
}

type TagData = {
  label: string
  typeLabel: string
  nodeType: KnowledgeNodeType
  color: string
  bg: string
  hasIn: boolean
  hasOut: boolean
  dimmed: boolean
  vertical: boolean
}

/** 知识图节点：类型徽标 + 标题。选中叠加类型色描边与淡色底；
 *  被筛选/聚焦淡化的节点降低透明度。自定义节点必须显式渲染 Handle，
 *  否则连线没有锚点不会绘制 */
function KnowledgeNodeTag({ data, selected }: NodeProps<TagData>) {
  const c = data.color
  return (
    <div
      style={{
        borderColor: selected ? c : 'rgb(var(--c-border-strong))',
        borderLeftColor: c,
        background: selected ? data.bg : 'rgb(var(--c-surface-2))',
        boxShadow: selected ? `0 0 0 2px ${c}40` : undefined,
      }}
      className={[
        'relative flex w-max max-w-[210px] cursor-pointer select-none flex-col gap-1',
        'rounded-lg border border-l-[3px] px-3 py-2',
        'transition-[opacity,border-color,background-color,box-shadow,transform] duration-1 ease-terminal',
        data.dimmed ? 'opacity-35' : 'opacity-100',
        selected ? 'shadow-lg' : 'hover:-translate-y-px hover:shadow-md',
      ].join(' ')}
    >
       <Handle
        type="target"
        position={data.vertical ? Position.Top : Position.Left}
        isConnectable={false}
        style={{ opacity: data.hasIn ? 1 : 0 }}
      />
      <span
        className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider"
        style={{ color: c }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} aria-hidden="true" />
        {data.typeLabel}
      </span>
      <span className="max-w-[190px] truncate text-sm font-semibold leading-snug text-ink">
        {data.label}
      </span>
       <Handle
        type="source"
        position={data.vertical ? Position.Bottom : Position.Right}
        isConnectable={false}
        style={{ opacity: data.hasOut ? 1 : 0 }}
      />
    </div>
  )
}

const nodeTypes: NodeTypes = { knowledge: KnowledgeNodeTag }

/** 重置布局后触发一次 fitView（需要在 ReactFlow 上下文内调用） */
function FitViewOnSignal({ signal }: { signal: number }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    if (signal <= 0) return
    const t = window.setTimeout(() => fitView({ padding: 0.18, duration: 280 }), 30)
    return () => window.clearTimeout(t)
  }, [signal, fitView])
  return null
}

export function KnowledgeCanvas({ nodes, edges, onSelect, selected }: TopicGraphProps) {
  const palette = useNodeTypePalette()
  const selectedId = selected ?? null

  const { positions, vertical } = useMemo(() => computeLayeredLayout(nodes, edges), [nodes, edges])
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const [typeFilter, setTypeFilter] = useState<Set<KnowledgeNodeType> | null>(null)
  const [resetSignal, setResetSignal] = useState(0)

  /** 图例数据：仅展示当前图中出现的类型 */
  const legend = useMemo(() => {
    const counts = new Map<KnowledgeNodeType, number>()
    for (const n of nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
    return NODE_TYPES.filter((m) => counts.has(m.key)).map((m) => ({
      meta: m,
      count: counts.get(m.key)!,
      resolved: palette[m.key],
    }))
  }, [nodes, palette])

  /** 选中节点的直接邻居（1 跳） */
  const neighborIds = useMemo(() => {
    if (!selectedId) return null
    const set = new Set<string>([selectedId])
    for (const e of edges) {
      if (e.source === selectedId) set.add(e.target)
      else if (e.target === selectedId) set.add(e.source)
    }
    return set
  }, [selectedId, edges])

  const dimmedNodeIds = useMemo(() => {
    const set = new Set<string>()
    for (const n of nodes) {
      if (typeFilter && !typeFilter.has(n.type)) set.add(n.id)
      else if (neighborIds && !neighborIds.has(n.id)) set.add(n.id)
    }
    return set
  }, [nodes, typeFilter, neighborIds])

  const baseNodes = useMemo<Node<TagData>[]>(
    () => {
      const hasIn = new Set(edges.map((e) => e.target))
      const hasOut = new Set(edges.map((e) => e.source))
      return nodes.map((n) => {
        const meta = nodeTypeMeta(n.type)
        const p = palette[n.type] ?? palette.driver
        return {
          id: n.id,
          type: 'knowledge',
          position: positions.get(n.id) ?? { x: 0, y: 0 },
          data: {
            label: n.label,
            typeLabel: meta.label,
            nodeType: n.type,
            color: p.color,
            bg: p.bg,
            hasIn: hasIn.has(n.id),
            hasOut: hasOut.has(n.id),
           dimmed: false,
           vertical,
         },
          draggable: true,
          selectable: true,
        }
      })
    },
    // palette 随主题切换需重建样式；positions/nodes/edges 决定结构与坐标
    [nodes, edges, positions, palette],
  )

  /** 受控节点表：拖拽由 onNodesChange 落回 state；高亮变化只改 data，
   *  合并时保留用户拖出来的 position，不会把节点弹回原位 */
  const [flowNodes, setFlowNodes] = useState<Node<TagData>[]>(() =>
    baseNodes.map((b) => ({ ...b, selected: b.id === selectedId, data: { ...b.data, dimmed: dimmedNodeIds.has(b.id) } })),
  )
  useEffect(() => {
    setFlowNodes((prev) =>
      baseNodes.map((b) => {
        const old = prev.find((p) => p.id === b.id)
        return {
          ...b,
          position: old?.position ?? b.position,
          selected: b.id === selectedId,
          data: { ...b.data, dimmed: dimmedNodeIds.has(b.id) },
        }
      }),
    )
  }, [baseNodes, dimmedNodeIds, selectedId])

  const onNodesChange = useCallback(
    (changes: Parameters<typeof applyNodeChanges<TagData>>[0]) =>
      setFlowNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  )

  const reactEdges = useMemo<Edge[]>(
    () =>
      edges.map((e, i) => {
        const srcType = nodeById.get(e.source)?.type
        const connected = selectedId != null && (e.source === selectedId || e.target === selectedId)
        const filteredOut =
          typeFilter != null &&
          (srcType == null ||
            !typeFilter.has(srcType) ||
            !typeFilter.has(nodeById.get(e.target)?.type as KnowledgeNodeType))
        const dim = filteredOut || (selectedId != null && !connected)
        const color = srcType
          ? typeColorOf(palette, srcType)
          : palette.driver.color
        return {
          id: `e${i}`,
          source: e.source,
          target: e.target,
          label: e.label,
          type: 'smoothstep',
          pathOptions: { borderRadius: 12 },
          // 仅选中态的少数连线跑流动动画，避免全图常驻重绘
          animated: connected,
          style: {
            stroke: color,
            strokeWidth: connected ? 2.2 : 1.4,
            opacity: dim ? 0.15 : 0.85,
          },
          labelStyle: {
            fill: 'rgb(var(--c-text-2))',
            fontSize: 11,
            fontWeight: 600,
            opacity: dim ? 0.4 : 1,
          },
          labelBgStyle: { fill: 'rgb(var(--c-surface))', fillOpacity: dim ? 0.6 : 1 },
          labelBgPadding: [7, 3] as [number, number],
          labelBgBorderRadius: 4,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            // SVG 属性不吃 CSS 变量，必须传解析后的实色
            color,
            width: 14,
            height: 14,
          },
        }
      }),
    [edges, nodeById, selectedId, typeFilter, palette],
  )

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      const found = nodes.find((n) => n.id === node.id)
      if (found && onSelect) onSelect(found)
    },
    [nodes, onSelect],
  )

  const onEdgeClick = useCallback(
    (_: unknown, edge: Edge) => {
      const found = nodes.find((n) => n.id === edge.source)
      if (found && onSelect) onSelect(found)
    },
    [nodes, onSelect],
  )

  const onResetLayout = useCallback(() => {
    setFlowNodes((prev) =>
      prev.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })),
    )
    setResetSignal((s) => s + 1)
  }, [positions])

  const toggleType = useCallback((key: KnowledgeNodeType) => {
    setTypeFilter((prev) => {
      if (prev == null) return new Set([key])
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
        return next.size === 0 ? null : next
      }
      next.add(key)
      return next
    })
  }, [])

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface" aria-label="知识图谱画布">
      {/* 图例工具条：类型筛选 + 操作入口 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {legend.map(({ meta, count, resolved }) => {
            const active = typeFilter?.has(meta.key) ?? false
            return (
              <button
                key={meta.key}
                type="button"
                onClick={() => toggleType(meta.key)}
                aria-pressed={active}
                title={`筛选「${meta.label}」类型节点`}
                style={active ? { color: resolved.color, borderColor: resolved.color, background: resolved.bg } : undefined}
                className={[
                  'inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-2xs transition-colors duration-1 ease-terminal',
                  active ? 'font-semibold' : 'text-ink-3 hover:border-line-strong hover:text-ink-2',
                ].join(' ')}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: resolved.color }}
                  aria-hidden="true"
                />
                {meta.label}
                <span className="num opacity-70">{count}</span>
              </button>
            )
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="hidden text-2xs text-ink-3 lg:inline">
            点击节点看详解 · 拖拽整理 · 滚轮缩放
          </span>
          <button
            type="button"
            onClick={onResetLayout}
            className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-2xs text-ink-3 transition-colors duration-1 ease-terminal hover:border-line-strong hover:text-ink"
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            重置布局
          </button>
        </div>
      </div>

      <div className="relative h-[360px] w-full sm:h-[500px] lg:h-[640px] xl:h-[760px]">
        <ReactFlow
          nodes={flowNodes}
          edges={reactEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={() => onSelect?.(null)}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.2}
          maxZoom={1.8}
          nodesConnectable={false}
          nodesDraggable
          nodesFocusable
          edgesFocusable={false}
          selectionKeyCode={null}
          elevateEdgesOnSelect
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgb(var(--c-border))" gap={22} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            className="hidden md:block"
            style={{ width: 150, height: 100 }}
            pannable
            zoomable
            nodeColor={(n) => typeColorOf(palette, (n.data as TagData).nodeType)}
            nodeStrokeWidth={2}
          />
          <FitViewOnSignal signal={resetSignal} />
        </ReactFlow>
      </div>
    </section>
  )
}
