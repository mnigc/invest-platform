export const TRIL: Record<string, Record<string, number>> = {
  US: { GDP: 0.001, PCE: 0.001, RSXFS: 0.000001 },
  CN: { GDP: 0.0001, RETAIL: 0.0001 },
}

export function applyScaling(region: string, code: string, value: number): number {
  const factor = TRIL[region]?.[code]
  return factor ? value * factor : value
}
