import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { handleApiRequest, isApiRoute } from './node-adapter.ts'

const root = resolve('dist')
const mediaTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
])

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'same-origin')
  response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
  try {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    if (isApiRoute(path)) {
      await handleApiRequest(request, response)
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path))
    const type = mediaTypes.get(extname(file))
    if (!type || !file.startsWith(root + sep)) {
      response.writeHead(404).end()
      return
    }
    const metadata = await stat(file)
    if (!metadata.isFile()) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': metadata.size,
      'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    if (request.method === 'HEAD') response.end()
    else createReadStream(file).on('error', () => response.destroy()).pipe(response)
  } catch {
    if (!response.headersSent) response.writeHead(404).end()
    else response.destroy()
  }
})

server.requestTimeout = 15_000
server.listen(Number(process.env.PORT ?? 4173), process.env.HOST ?? '127.0.0.1', () => {
  console.log('superr-typeeng is listening at %o', server.address())
})
