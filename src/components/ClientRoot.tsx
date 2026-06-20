import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const QC = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 5 * 60 * 1000, gcTime: Infinity },
  },
})

export default function ClientRoot({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={QC}>{children}</QueryClientProvider>
}
