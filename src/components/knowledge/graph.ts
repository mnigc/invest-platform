import { useMemo } from 'react'
import { useThemeMode } from '../ui/theme'

/* =============================================================================
 * 知识图谱共享模型（框架无关，ReactFlow 之外也可安全引用）
 *
 * 节点类型色是领域语义色，不随主题改变「色相」，但随主题切换明度档位：
 *   - dark 主题用 400 档（亮），light 主题用 700 档（深），保证两端都可读。
 *   - ReactFlow 的连线描边、箭头 marker 与小地图颜色走 SVG 属性，
 *     CSS 变量在属性里不解析，所以这里提供运行时解析好的调色板（同 ui/theme.tsx 的做法）。
 *   - DOM 侧（.astro 静态图例）用 tokens.css 的 --kn-* 变量，色值需与本文件同步。
 * ============================================================================= */

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

export interface KnowledgeTopic {
  title: string
  subtitle: string
  intro: string
  conclusion: string
  strategy: string[]
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
}

export type KnowledgeNodeType = KnowledgeNode['type']

export interface NodeTypeMeta {
  key: KnowledgeNodeType
  /** 图例中展示的中文名 */
  label: string
  /** tokens.css 对应的 --kn-* 变量名（DOM 静态场景使用） */
  cssVar: string
  dark: string
  light: string
}

/** 图例顺序即展示顺序 */
export const NODE_TYPES: NodeTypeMeta[] = [
  { key: 'driver', label: '驱动因素', cssVar: '--kn-driver', dark: '#fbbf24', light: '#b45309' },
  { key: 'signal', label: '观察信号', cssVar: '--kn-signal', dark: '#22d3ee', light: '#0e7490' },
  { key: 'response', label: '政策响应', cssVar: '--kn-response', dark: '#60a5fa', light: '#1d4ed8' },
  { key: 'asset', label: '资产', cssVar: '--kn-asset', dark: '#f87171', light: '#b91c1c' },
  { key: 'market', label: '市场含义', cssVar: '--kn-market', dark: '#a78bfa', light: '#6d28d9' },
  { key: 'regime', label: '宏观状态', cssVar: '--kn-regime', dark: '#34d399', light: '#047857' },
  { key: 'structural', label: '结构机制', cssVar: '--kn-structural', dark: '#94a3b8', light: '#475569' },
  { key: 'case', label: '历史案例', cssVar: '--kn-case', dark: '#f0abfc', light: '#a21caf' },
  { key: 'cross', label: '跨市场', cssVar: '--kn-cross', dark: '#fb923c', light: '#c2410c' },
]

export const NODE_TYPE_MAP: Record<KnowledgeNodeType, NodeTypeMeta> = Object.fromEntries(
  NODE_TYPES.map((m) => [m.key, m]),
) as Record<KnowledgeNodeType, NodeTypeMeta>

export function nodeTypeMeta(type: KnowledgeNodeType): NodeTypeMeta {
  return NODE_TYPE_MAP[type] ?? NODE_TYPE_MAP.driver
}

export interface ResolvedNodeType {
  /** 实色（SVG 属性安全：marker / minimap / 连线描边可直接用） */
  color: string
  /** 同色 16% 透明度的浅底（8 位 hex，属性同样安全） */
  bg: string
  cssVar: string
  label: string
}

function resolve(meta: NodeTypeMeta, mode: 'dark' | 'light'): ResolvedNodeType {
  const color = mode === 'dark' ? meta.dark : meta.light
  return { color, bg: `${color}29`, cssVar: `var(${meta.cssVar})`, label: meta.label }
}

export type NodeTypePalette = Record<KnowledgeNodeType, ResolvedNodeType>

/** 随 html[data-theme] 自动切换的节点类型调色板（SSR 首帧为 dark 档） */
export function useNodeTypePalette(): NodeTypePalette {
  const mode = useThemeMode()
  return useMemo(
    () => Object.fromEntries(NODE_TYPES.map((m) => [m.key, resolve(m, mode)])) as NodeTypePalette,
    [mode],
  )
}

export function typeColorOf(palette: NodeTypePalette, type: KnowledgeNodeType): string {
  return (palette[type] ?? palette.driver).color
}
