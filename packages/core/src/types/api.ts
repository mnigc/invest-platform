export interface ApiMeta {
  updatedAt: string
  source: string
  cachedAt?: string
}

export interface ApiResponse<T> {
  success: true
  data: T
  meta?: ApiMeta
  error?: never
}

export interface ApiError {
  success: false
  data?: never
  meta?: never
  error: string
}

export type ApiResult<T> = ApiResponse<T> | ApiError
