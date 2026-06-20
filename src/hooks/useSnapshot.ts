import { useQuery } from '@tanstack/react-query'
import { fetchApi, type UsSnapshotData, type CnSnapshotData } from '../lib/api'

export function useUsSnapshot() {
  return useQuery({
    queryKey: ['snapshot', 'us'],
    queryFn: () => fetchApi<UsSnapshotData>('/snapshot/us'),
  })
}

export function useCnSnapshot() {
  return useQuery({
    queryKey: ['snapshot', 'cn'],
    queryFn: () => fetchApi<CnSnapshotData>('/snapshot/cn'),
  })
}
