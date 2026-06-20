export interface YieldCurvePoint {
  tenor: string
  yield: number
  change?: number
}

export interface BondSpread {
  label: string
  value: number
  change?: number
  percentile5y?: number
}

export interface YieldCurveResponse {
  country: string
  date: string
  curve: YieldCurvePoint[]
  spreads: BondSpread[]
}
