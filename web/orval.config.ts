import { defineConfig } from 'orval'

// 契约来源：api/scripts/export_openapi.py 导出的 openapi.json。
// 生成目录 src/api/generated/ 不要手改，改后端后重新执行 npm run gen:api。
export default defineConfig({
  hdip: {
    input: './openapi.json',
    output: {
      mode: 'tags-split',
      target: './src/api/generated/hdip.ts',
      schemas: './src/api/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      override: {
        mutator: { path: './src/api/fetcher.ts', name: 'hdipFetch' },
      },
    },
  },
})
