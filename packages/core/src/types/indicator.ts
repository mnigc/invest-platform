import { z } from 'zod'

export const IndicatorSchema = z.object({
  code: z.string(),
  name_zh: z.string(),
  name_en: z.string().optional(),
  region: z.enum(['US', 'CN', 'GLOBAL']),
  category: z.string(),
  sub_category: z.string().optional(),
  unit: z.string(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']),
  source: z.string(),
})
export type Indicator = z.infer<typeof IndicatorSchema>

export const DataPointSchema = z.object({
  period_date: z.string(),
  value: z.number().nullable(),
  cnt: z.number().optional(),
  expected_cnt: z.number().optional(),
})
export type DataPoint = z.infer<typeof DataPointSchema>

export const IndicatorDataResponseSchema = z.object({
  indicator: IndicatorSchema,
  data: z.array(DataPointSchema),
})
export type IndicatorDataResponse = z.infer<typeof IndicatorDataResponseSchema>
