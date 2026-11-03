import { existsSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { handleHealth, handlePassage, handleQuota, type PassageEnv } from './passage.ts'

const MAX_BODY_BYTES = 4096
const FORWARDED_HEADERS = [
  'authorization',
  'content-type',
  'cookie',
  'origin',
  'sec-fetch-site',
  'cf-turnstile-response',
  'cf-connecting-ip',
  'x-forwarded-for',
] as const

let cachedAccountId: string | null = null

function readWranglerOAuthToken(): string | null {
  const envToken = process.env.CLOUDFLARE_API_TOKEN?.trim()
  if (envToken) return envToken

  const candidates = [
    join(homedir(), '.config', '.wrangler', 'config', 'default.toml'),
    join(homedir(), '.wrangler', 'config', 'default.toml'),
  ]
  for (const filePath of candidates) {
    try {
      if (!existsSync(filePath)) continue
      const content = readFileSync(filePath, 'utf8')
      const match = /oauth_token\s*=\s*"([^"]+)"/.exec(content)
      if (match?.[1]?.trim()) return match[1].trim()
    } catch {
      // Ignore unreadable local config files.
    }
  }
  return null
}

async function resolveCloudflareAccountId(token: string): Promise<string | null> {
  const envAccount = process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
  if (envAccount) return envAccount
  if (cachedAccountId) return cachedAccountId

  try {
    const cacheFile = join(process.cwd(), 'node_modules', '.cache', 'wrangler', 'wrangler-account.json')
    if (existsSync(cacheFile)) {
      const parsed = JSON.parse(readFileSync(cacheFile, 'utf8')) as { account?: { id?: unknown } }
      if (typeof parsed.account?.id === 'string' && parsed.account.id.trim()) {
        cachedAccountId = parsed.account.id.trim()
        return cachedAccountId
      }
    }
  } catch {
    // Fall back to Cloudflare accounts API lookup.
  }

  try {
    const response = await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=1', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return null
    const data = (await response.json()) as { result?: Array<{ id?: unknown }> }
    const firstId = data.result?.[0]?.id
    if (typeof firstId === 'string' && firstId.trim()) {
      cachedAccountId = firstId.trim()
      return cachedAccountId
    }
  } catch {
    // Ignore network lookup failure in offline local mode.
  }
  return null
}

function resolveLocalNodeEnv(explicitEnv?: PassageEnv): PassageEnv | undefined {
  if (explicitEnv) return explicitEnv
  const token = readWranglerOAuthToken()
  if (!token) return undefined

  return {
    AI: {
      async run(model: string, inputs: Record<string, unknown>) {
        const currentToken = readWranglerOAuthToken() ?? token
        const accountId = await resolveCloudflareAccountId(currentToken)
        if (!accountId) {
          throw new Error('Cloudflare account ID is not available for local Workers AI bridge.')
        }
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${currentToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(inputs),
          },
        )
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          throw Object.assign(new Error(`Workers AI HTTP ${response.status}: ${text}`), {
            status: response.status,
          })
        }
        return response.json()
      },
    },
  }
}

function respond(response: ServerResponse, status: number, message: string) {
  if (response.destroyed || response.headersSent) return
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify({ error: message }))
}

export function isApiRoute(pathname: string): boolean {
  return (
    pathname === '/api/generate-passage'
    || pathname === '/api/passage'
    || pathname === '/api/quota'
    || pathname === '/api/health'
  )
}

export async function handleApiRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  env?: PassageEnv,
) {
  const controller = new AbortController()
  const onClose = () => controller.abort()
  outgoing.once('close', onClose)
  try {
    let body: string | undefined
    if (incoming.method === 'POST') {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of incoming.iterator({ destroyOnReturn: false })) {
        const bytes = Buffer.from(chunk)
        size += bytes.length
        if (size > MAX_BODY_BYTES) {
          outgoing.setHeader('Connection', 'close')
          respond(outgoing, 413, 'This request is too large.')
          return
        }
        chunks.push(bytes)
      }
      body = Buffer.concat(chunks).toString('utf8')
    }
    const headers = new Headers()
    for (const name of FORWARDED_HEADERS) {
      const value = incoming.headers[name]
      if (typeof value === 'string') headers.set(name, value)
    }
    const host = typeof incoming.headers.host === 'string' && incoming.headers.host
      ? incoming.headers.host
      : 'localhost'
    const url = new URL(incoming.url ?? '/api/passage', `http://${host}`)
    const request = new Request(url.toString(), {
      method: incoming.method ?? 'GET',
      headers,
      body,
      signal: controller.signal,
    })
    const pathname = decodeURIComponent(url.pathname)
    const clientIp = incoming.socket.remoteAddress ?? 'unknown'
    const resolvedEnv = resolveLocalNodeEnv(env)
    const result = pathname === '/api/health'
      ? handleHealth(request, resolvedEnv)
      : pathname === '/api/quota'
        ? await handleQuota(request, clientIp, resolvedEnv)
        : await handlePassage(request, clientIp, resolvedEnv)
    if (outgoing.destroyed) return
    outgoing.writeHead(result.status, Object.fromEntries(result.headers))
    outgoing.end(await result.text())
  } catch {
    respond(outgoing, 500, 'Something went wrong. Try again.')
  } finally {
    outgoing.off('close', onClose)
  }
}
