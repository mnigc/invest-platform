export const THEME = {
  blue: '#3B82F6',
  blueHover: '#60A5FA',
  blueDim: 'rgba(59, 130, 246, 0.12)',
  blueArea: 'rgba(59, 130, 246, 0.08)',
  cyan: '#06B6D4',
  cyanDim: 'rgba(6, 182, 212, 0.12)',
  gold: '#F59E0B',
  goldDim: 'rgba(245, 158, 11, 0.12)',
  bgCard: '#131722',
  bgCardHover: '#1C2128',
  bgElevated: '#1C2128',
  borderColor: '#2A2E39',
  borderLight: 'rgba(42, 46, 57, 0.35)',
  textMuted: '#6B7280',
  textSecondary: '#9CA3AF',
  textPrimary: '#FFFFFF',
  red: '#F23645',
  redBg: 'rgba(242, 54, 69, 0.15)',
  green: '#089981',
  greenBg: 'rgba(8, 153, 129, 0.15)',
  fontMono: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, 'SF Mono', 'Fira Code', Consolas, monospace",
  fontDisplay: "'Orbitron', -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  fontBody: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
} as const

export const CARD_STYLES: React.CSSProperties = {
  background: THEME.bgCard,
  border: `1px solid ${THEME.borderLight}`,
  borderRadius: '16px',
  padding: '16px',
  transition: 'all 0.2s ease',
}

export const CARD_HOVER: React.CSSProperties = {
  borderColor: THEME.blue,
}
