import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiError } from './api/fetcher'
import { App } from './App'
import { AppToaster } from './components/kit/toaster'
import './index.css'
import { initTheme } from './lib/theme'

initTheme()

const queryClient = new QueryClient({
  // 4xx（身份、无权、找不到、参数）是确定的答复，不再重试；其他失败重试一次
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <AppToaster />
    </QueryClientProvider>
  </StrictMode>,
)
