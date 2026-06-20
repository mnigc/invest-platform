import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

export function QueryProvider({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5 * 60 * 1000, retry: 2, refetchOnWindowFocus: false },
    },
  }))
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}
