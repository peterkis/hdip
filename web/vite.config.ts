import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    port: 5173,
    // 剧本走查时（make web-walk）指向走查库的后端
    proxy: { '/api': process.env.HDIP_API_URL ?? 'http://localhost:8000' },
  },
})
