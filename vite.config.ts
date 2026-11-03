import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { handleApiRequest } from './server/node-adapter.ts'

const API_PATHS = new Set(['/api/generate-passage', '/api/passage', '/api/quota', '/api/health'])

async function proxyToWorker(incoming: IncomingMessage, outgoing: ServerResponse, workerDevUrl: string) {
  const controller = new AbortController()
  const onClose = () => controller.abort()
  outgoing.once('close', onClose)
  try {
    let body: string | undefined
    if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
      const chunks: Buffer[] = []
      for await (const chunk of incoming.iterator({ destroyOnReturn: false })) {
        chunks.push(Buffer.from(chunk))
      }
      body = Buffer.concat(chunks).toString('utf8')
    }
    const headers = new Headers()
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (name === 'host' || name === 'connection' || value === undefined) continue
      headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    }
    const targetUrl = new URL(incoming.url ?? '/', workerDevUrl)
    const result = await fetch(targetUrl, {
      method: incoming.method,
      headers,
      body,
      redirect: 'manual',
      signal: controller.signal,
    })
    if (outgoing.destroyed || outgoing.headersSent) return
    outgoing.writeHead(result.status, Object.fromEntries(result.headers))
    outgoing.end(Buffer.from(await result.arrayBuffer()))
  } catch {
    if (!outgoing.destroyed && !outgoing.headersSent) {
      outgoing.writeHead(502, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      outgoing.end(JSON.stringify({ error: 'Could not connect. Try again.' }))
    }
  } finally {
    outgoing.off('close', onClose)
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'passage-endpoint',
      configureServer(server) {
        if (existsSync('.env')) process.loadEnvFile()
        server.middlewares.use((request, response, next) => {
          const path = request.url?.split('?')[0]
          if (path && API_PATHS.has(path)) {
            const workerDevUrl = process.env.WORKER_DEV_URL?.trim()
            if (workerDevUrl) {
              void proxyToWorker(request, response, workerDevUrl)
            } else {
              void handleApiRequest(request, response)
            }
          } else {
            next()
          }
        })
      },
    },
  ],
})

