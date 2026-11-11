import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { loadBackendSettings, resolveBackendOrigin } from './scripts/backend-origin.mjs'

const backend = resolveBackendOrigin(process.env, loadBackendSettings())

function configureProxy(proxy: any) {
  proxy.on('proxyReq', (proxyReq: any, req: any) => {
    for (const name of ['forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for', 'x-real-ip', 'x-client-ip', 'x-host', 'x-original-host']) proxyReq.removeHeader(name)
    proxyReq.setHeader('x-deeptutor-frontend-host', req.headers.host || '')
  })
  proxy.on('error', (_error: Error, _req: unknown, res: any) => {
    if (!res || typeof res.writeHead !== 'function' || res.headersSent) return
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ detail: '无法连接 DeepTutor 后端服务。请确认后端已启动，并检查 Vite 的 API 代理地址。' }))
  })
}

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/views/ChatPage.vue')) return 'chat-workspace'
          if (id.includes('/node_modules/pdfjs-dist/')) return 'pdfjs'
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true, configure: configureProxy },
      '/auth/callback': { target: backend, changeOrigin: true, configure: configureProxy, rewrite: path => path.replace(/^\/auth\/callback/, '/api/auth/openai-codex/callback') },
      '/ws': { target: backend, ws: true, changeOrigin: true, configure: configureProxy },
      '/files': { target: backend, changeOrigin: true, configure: configureProxy },
    },
  },
})
