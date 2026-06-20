export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical'

export interface Anomaly {
  id: string
  title: string
  description: string
  severity: AnomalySeverity
  indicator: string
  currentValue: string
  threshold: string
  detail?: string
}

export interface AnomalyResponse {
  anomalies: Anomaly[]
  totalCount: number
  highCount: number
  updatedAt: string
}
