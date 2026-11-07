import { z } from 'zod'
import {
  isDuration,
  PASSAGE_LIMITS,
  splitGraphemes,
  TOPIC_MAX_LENGTH,
  TOPIC_MAX_CODE_UNITS,
  type Duration,
} from '../src/shared/passage.ts'
import {
  buildPassageUserPrompt,
  DEFAULT_AI_MODEL,
  PASSAGE_SYSTEM_PROMPT,
} from './system-prompt.ts'
import { isPersonalKey, type AiProviderId, type ByokConfig } from '../src/shared/personal-key.ts'
import {
  generateByokPassage,
  openAiResponsesFormat,
  parseRequestByokConfig,
  ProviderAuthenticationError,
  ProviderQuotaError,
  workersAiResponseFormat,
} from './providers.ts'
import {
  commitQuotaSlot,
  currentKolkataDay,
  DAILY_FREE_LIMIT,
  getQuotaStatus,
  QUOTA_TIME_ZONE,
  releaseQuotaSlot,
  reserveQuotaSlot,
  resetsAtForKolkataDay,
  resolveVisitorIdentity,
  toQuotaSummary,
  type QuotaEndpointPayload,
  type QuotaEnv,
  type QuotaSummary,
} from './quota.ts'

export const MODEL_ID = DEFAULT_AI_MODEL
const DEFAULT_OPENAI_MODEL = 'gpt-6-luna'
const REQUEST_BYTES = 4096
const PROVIDER_BYTES = 65536
const GENERATION_TIMEOUT_MS = 35_000
const WINDOW_MS = 60_000
const REQUESTS_PER_WINDOW = 8
const MAX_RATE_LIMIT_KEYS = 4096
const MAX_CONCURRENT_GENERATIONS = 16

const DEFAULT_DEV_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
  'http://localhost:8788',
  'http://127.0.0.1:8788',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost',
  'http://127.0.0.1',
])

export interface PassageEnv extends QuotaEnv {
  AI?: {
    run(
      model: string,
      inputs: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<unknown>
  }
  AI_MODEL?: string
  ALLOWED_ORIGINS?: string
  PASSAGE_RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>
  }
  TURNSTILE_SECRET_KEY?: string
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
}

export type Env = PassageEnv

export interface PassageSuccessPayload {
  passage: string
  model: string
  provider: 'shared' | AiProviderId
  wordCount: number
  characterCount: number
  quota: QuotaSummary
}

export interface DailyQuotaErrorPayload {
  error: string
  code: 'DAILY_QUOTA_EXHAUSTED'
  quota: QuotaSummary
}

export interface HealthPayload {
  status: 'ok'
  provider: 'cloudflare-workers-ai'
  model: string
  aiAvailable: boolean
  quota: QuotaSummary
}

const requestSchema = z.strictObject({
  topic: z.string().max(TOPIC_MAX_CODE_UNITS).trim().min(1)
    .refine(topic => splitGraphemes(topic).length <= TOPIC_MAX_LENGTH),
  duration: z.custom<Duration>(isDuration),
  turnstileToken: z.string().trim().min(1).max(2048).optional(),
  provider: z.unknown().optional(),
})

const passageSchema = z.strictObject({ passage: z.string() })
const responseSchema = z.object({
  status: z.literal('completed'),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })),
})

const activeClients = new Set<string>()
const requestsByClient = new Map<string, number>()
let windowEndsAt = 0

class BodyTooLarge extends Error {}

function json(
  body:
    | PassageSuccessPayload
    | HealthPayload
    | QuotaEndpointPayload
    | DailyQuotaErrorPayload
    | { error: string },
  status = 200,
  headers?: HeadersInit,
) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'no-store')
  return Response.json(body, { status, headers: responseHeaders })
}

function readProcessEnv(key: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[key]?.trim() : undefined
}

function parseConfiguredOrigins(env?: PassageEnv): Set<string> | null {
  const raw = (env?.ALLOWED_ORIGINS?.trim() || readProcessEnv('ALLOWED_ORIGINS'))
  if (!raw) return null
  const origins = raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  return origins.length > 0 ? new Set(origins) : null
}

function getRequestOrigin(request: Request): string | null {
  try {
    return new URL(request.url).origin
  } catch {
    return null
  }
}

function matchesConfiguredOrigin(origin: string, configured: Set<string>): boolean {
  if (configured.has(origin)) return true
  for (const entry of configured) {
    if (!entry.includes('*')) continue
    const pattern = new RegExp(
      `^${entry.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+')}$`,
      'i',
    )
    if (pattern.test(origin)) return true
  }
  return false
}

export function isAllowedOrigin(origin: string, request: Request, env?: PassageEnv): boolean {
  const normalized = origin.trim()
  if (!normalized || normalized === 'null') return false

  const requestOrigin = getRequestOrigin(request)
  if (requestOrigin && normalized === requestOrigin) return true

  const configured = parseConfiguredOrigins(env)
  if (configured) {
    return matchesConfiguredOrigin(normalized, configured)
  }

  if (DEFAULT_DEV_ORIGINS.has(normalized)) return true
  return /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(normalized)
}

function buildCorsHeaders(origin: string | null, request: Request, env?: PassageEnv): Headers {
  const headers = new Headers()
  if (origin && isAllowedOrigin(origin, request, env)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  }
  return headers
}

function handlePreflight(request: Request, env?: PassageEnv): Response {
  const origin = request.headers.get('origin')
  if (origin !== null && !isAllowedOrigin(origin, request, env)) {
    return json({ error: 'Generate a passage from superr-typeeng.' }, 403)
  }
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, CF-Turnstile-Response',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  })
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
  }
  return new Response(null, { status: 204, headers })
}

export function resolveWorkersAiModel(env?: PassageEnv): string {
  return env?.AI_MODEL?.trim() || readProcessEnv('AI_MODEL') || MODEL_ID
}

export function maxTokensForDuration(duration: Duration): number {
  const { maxChars } = PASSAGE_LIMITS[duration]
  return Math.max(duration === 180 ? 1600 : 512, Math.ceil(maxChars / 2.2) + 256)
}

export function countWords(passage: string): number {
  const trimmed = passage.trim()
  return trimmed ? trimmed.split(/\s+/u).filter(Boolean).length : 0
}

/** Read at most the byte limit before decoding untrusted JSON. */
async function readJson(message: Request | Response, maxBytes: number): Promise<unknown> {
  if (Number(message.headers.get('content-length')) > maxBytes) {
    void message.body?.cancel().catch(() => undefined)
    throw new BodyTooLarge()
  }
  if (!message.body) throw new SyntaxError('Empty body')

  const reader = message.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let decoded = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) throw new BodyTooLarge()
      decoded += decoder.decode(value, { stream: true })
    }
    return JSON.parse(decoded + decoder.decode()) as unknown
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
}

/** Normalize layout whitespace only. Keep punctuation and visible character sequences intact. */
export function validatePassage(value: unknown, duration: Duration): string | null {
  const parsed = passageSchema.safeParse(value)
  if (!parsed.success) return null
  const raw = parsed.data.passage.trim()
  if (/^[\t ]*(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s)|```|<\/?[a-z][^>]*>/imu.test(raw)) return null

  if (/^(?:"[\s\S]*"|“[\s\S]*”)$/u.test(raw)) return null
  const passage = raw.replace(/[^\S ]+/gu, ' ')
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(passage) || !/\p{L}/u.test(passage)) return null

  const { minChars, maxChars } = PASSAGE_LIMITS[duration]
  const length = splitGraphemes(passage).length
  return length >= minChars && length <= maxChars ? passage : null
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const match = /^```(?:json)?[\t ]*\r?\n?([\s\S]*?)\r?\n?```$/i.exec(trimmed)
  return match ? match[1]!.trim() : trimmed
}

function parsePassageText(text: string, duration: Duration): string | null {
  const candidate = stripCodeFence(text)
  if (!candidate) return null
  try {
    return validatePassage(JSON.parse(candidate) as unknown, duration)
  } catch {
    return null
  }
}

function readOpenAiResponsesPassage(value: unknown, duration: Duration): string | null {
  const parsed = responseSchema.safeParse(value)
  if (!parsed.success) return null
  const parts = parsed.data.output
    .filter(({ type }) => type === 'message')
    .flatMap(({ content }) => content ?? [])

  if (parts.some(({ type }) => type === 'refusal')) return null
  const output = parts.filter(({ type }) => type === 'output_text')
  if (output.length !== 1 || !output[0]?.text) return null

  return parsePassageText(output[0].text, duration)
}

export function readWorkersAiPassage(value: unknown, duration: Duration): string | null {
  if (typeof value === 'string') {
    return parsePassageText(value, duration)
  }
  if (!value || typeof value !== 'object') return null

  if ('passage' in value) {
    return validatePassage(value, duration)
  }

  if ('response' in value) {
    const responseField = (value as { response?: unknown }).response
    if (typeof responseField === 'string') {
      return parsePassageText(responseField, duration)
    }
    if (responseField && typeof responseField === 'object') {
      return validatePassage(responseField, duration)
    }
  }

  if ('result' in value) {
    const resultField = (value as { result?: unknown }).result
    if (resultField && typeof resultField === 'object') {
      const nested = readWorkersAiPassage(resultField, duration)
      if (nested !== null) return nested
    }
  }

  if ('choices' in value && Array.isArray((value as { choices?: unknown }).choices)) {
    const choices = (value as { choices: unknown[] }).choices
    const first = choices[0]
    if (first && typeof first === 'object' && 'message' in first) {
      const message = (first as { message?: unknown }).message
      if (message && typeof message === 'object') {
        if ('refusal' in message && Boolean((message as { refusal?: unknown }).refusal)) {
          return null
        }
        if ('content' in message) {
          const content = (message as { content?: unknown }).content
          if (typeof content === 'string') {
            return parsePassageText(content, duration)
          }
          if (content && typeof content === 'object') {
            return validatePassage(content, duration)
          }
        }
      }
    }
  }

  return readOpenAiResponsesPassage(value, duration)
}

function isQuotaOrRateLimitError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object') {
    const status = (error as { status?: unknown; statusCode?: unknown }).status
      ?? (error as { statusCode?: unknown }).statusCode
    if (status === 429) return true
  }
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : JSON.stringify(error)
  return /quota|neuron|daily limit|rate limit|\b429\b|too many requests/i.test(message)
}

function isAuthenticationError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object') {
    const status = (error as { status?: unknown; statusCode?: unknown }).status
      ?? (error as { statusCode?: unknown }).statusCode
    if (status === 401 || status === 403) return true
  }
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /\b(?:401|403|unauthorized|authentication failed|invalid api key)\b/i.test(message)
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

async function generateWorkersAiPassage(
  { topic, duration }: { topic: string; duration: Duration },
  ai: NonNullable<PassageEnv['AI']>,
  modelId: string,
  signal: AbortSignal,
): Promise<string | null> {
  const maxTokens = maxTokensForDuration(duration)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal.throwIfAborted()
    let rawResponse: unknown
    try {
      rawResponse = await withAbort(
        ai.run(modelId, {
          messages: [
            { role: 'system', content: PASSAGE_SYSTEM_PROMPT },
            { role: 'user', content: buildPassageUserPrompt(topic, duration, attempt > 0) },
          ],
          chat_template_kwargs: { enable_thinking: false },
          max_tokens: maxTokens,
          temperature: 0.7,
          response_format: workersAiResponseFormat,
        }),
        signal,
      )
    } catch (error) {
      signal.throwIfAborted()
      if (isQuotaOrRateLimitError(error)) throw new ProviderQuotaError('Cloudflare Workers AI')
      if (isAuthenticationError(error)) throw new ProviderAuthenticationError('Cloudflare Workers AI')
      return null
    }
    signal.throwIfAborted()
    const passage = readWorkersAiPassage(rawResponse, duration)
    if (passage !== null) return passage
  }

  return null
}

async function generateOpenAiPassage(
  { topic, duration }: { topic: string; duration: Duration },
  apiKey: string,
  model: string,
  signal: AbortSignal,
): Promise<string | null> {
  const { minChars, maxChars, minWords, maxWords } = PASSAGE_LIMITS[duration]

  // One retry gives the model a second opportunity to meet the bounds.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal.throwIfAborted()
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model,
        store: false,
        ...(model === DEFAULT_OPENAI_MODEL ? { reasoning: { effort: 'none' } } : {}),
        instructions: PASSAGE_SYSTEM_PROMPT,
        input: JSON.stringify({
          topic,
          length: { minChars, maxChars, minWords, maxWords },
          ...(attempt ? { guidance: 'A prior answer failed validation. Generate a fresh passage and prioritize the required character bounds.' } : {}),
        }),
        text: { format: openAiResponsesFormat },
        max_output_tokens: Math.ceil(maxChars / 2) + 128,
      }),
    })
    signal.throwIfAborted()
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      if (response.status === 401 || response.status === 403) throw new ProviderAuthenticationError('OpenAI')
      if (response.status === 429) throw new ProviderQuotaError('OpenAI')
      return null
    }

    let value: unknown
    try {
      value = await readJson(response, PROVIDER_BYTES)
    } catch (error) {
      signal.throwIfAborted()
      if (!(error instanceof SyntaxError)) return null
      continue
    }
    signal.throwIfAborted()
    const passage = readWorkersAiPassage(value, duration)
    if (passage !== null) return passage
  }

  return null
}

async function verifyTurnstileToken(
  secret: string,
  token: string,
  clientKey: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        secret,
        response: token,
        ...(clientKey && clientKey !== 'unknown' ? { remoteip: clientKey } : {}),
      }),
    })
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      return false
    }
    const result = await readJson(response, 4096)
    return Boolean(result && typeof result === 'object' && (result as { success?: unknown }).success === true)
  } catch {
    return false
  }
}

function resolveClientKey(request: Request, clientKey?: string): string {
  return (
    clientKey
    ?? request.headers.get('cf-connecting-ip')?.trim()
    ?? 'unknown'
  )
}

export function handleHealth(request: Request, env?: PassageEnv): Response {
  if (request.method === 'OPTIONS') {
    return handlePreflight(request, env)
  }
  const origin = request.headers.get('origin')
  if (origin !== null && !isAllowedOrigin(origin, request, env)) {
    return json({ error: 'Generate a passage from superr-typeeng.' }, 403)
  }
  const corsHeaders = buildCorsHeaders(origin, request, env)
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    corsHeaders.set('Allow', 'GET, HEAD, OPTIONS')
    return json({ error: 'Use GET to check health.' }, 405, corsHeaders)
  }

  const model = resolveWorkersAiModel(env)
  const aiAvailable = Boolean(
    env?.AI || env?.OPENAI_API_KEY?.trim() || readProcessEnv('OPENAI_API_KEY'),
  )
  const day = currentKolkataDay()
  const payload: HealthPayload = {
    status: 'ok',
    provider: 'cloudflare-workers-ai',
    model,
    aiAvailable,
    quota: {
      limit: DAILY_FREE_LIMIT,
      used: 0,
      remaining: DAILY_FREE_LIMIT,
      resetsAt: resetsAtForKolkataDay(day),
    },
  }
  if (request.method === 'HEAD') {
    corsHeaders.set('Cache-Control', 'no-store')
    corsHeaders.set('Content-Type', 'application/json; charset=utf-8')
    return new Response(null, { status: 200, headers: corsHeaders })
  }
  return json(payload, 200, corsHeaders)
}

export async function handleQuota(
  request: Request,
  clientKey?: string,
  env?: PassageEnv,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return handlePreflight(request, env)
  }
  const origin = request.headers.get('origin')
  if (origin !== null && !isAllowedOrigin(origin, request, env)) {
    return json({ error: 'Generate a passage from superr-typeeng.' }, 403)
  }
  const corsHeaders = buildCorsHeaders(origin, request, env)
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    corsHeaders.set('Allow', 'GET, HEAD, OPTIONS')
    return json({ error: 'Use GET to check quota.' }, 405, corsHeaders)
  }

  const resolvedClientKey = resolveClientKey(request, clientKey)
  const identity = await resolveVisitorIdentity(request, resolvedClientKey, env)
  if (identity.setCookieHeader) {
    corsHeaders.set('Set-Cookie', identity.setCookieHeader)
  }

  const day = currentKolkataDay()
  const status = await getQuotaStatus(identity.visitorKey, day, env)
  const payload: QuotaEndpointPayload = {
    limit: status.limit,
    used: status.used,
    remaining: status.remaining,
    resetsAt: status.resetsAt,
    timeZone: QUOTA_TIME_ZONE,
  }

  if (request.method === 'HEAD') {
    corsHeaders.set('Cache-Control', 'no-store')
    corsHeaders.set('Content-Type', 'application/json; charset=utf-8')
    return new Response(null, { status: 200, headers: corsHeaders })
  }
  return json(payload, 200, corsHeaders)
}

export async function handlePassage(
  request: Request,
  clientKey?: string,
  env?: PassageEnv,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return handlePreflight(request, env)
  }

  const origin = request.headers.get('origin')
  const originAllowed = origin !== null ? isAllowedOrigin(origin, request, env) : false
  if (origin !== null && !originAllowed) {
    return json({ error: 'Generate a passage from superr-typeeng.' }, 403)
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site' && !originAllowed) {
    return json({ error: 'Generate a passage from superr-typeeng.' }, 403)
  }

  const corsHeaders = buildCorsHeaders(origin, request, env)

  if (request.method !== 'POST') {
    corsHeaders.set('Allow', 'POST, OPTIONS')
    return json({ error: 'Use POST to generate a passage.' }, 405, corsHeaders)
  }
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') ?? '')) {
    return json({ error: 'Send the topic and duration as JSON.' }, 415, corsHeaders)
  }
  if (request.signal.aborted) return json({ error: 'Generation was canceled.' }, 499, corsHeaders)

  let data: unknown
  try {
    data = await readJson(request, REQUEST_BYTES)
  } catch (error) {
    if (error instanceof BodyTooLarge) return json({ error: 'The request is too large.' }, 413, corsHeaders)
    return json({ error: 'The request could not be read.' }, 400, corsHeaders)
  }
  if (request.signal.aborted) return json({ error: 'Generation was canceled.' }, 499, corsHeaders)
  const parsed = requestSchema.safeParse(data)
  if (!parsed.success) {
    return json(
      { error: `Enter a topic of 1–${TOPIC_MAX_LENGTH} characters and choose an available duration.` },
      400,
      corsHeaders,
    )
  }

  let bodyByokConfig: ByokConfig | null = null
  if (parsed.data.provider !== undefined && parsed.data.provider !== null) {
    bodyByokConfig = parseRequestByokConfig(parsed.data.provider)
    if (!bodyByokConfig) {
      return json(
        { error: 'Check your API key and provider configuration in Settings.' },
        400,
        corsHeaders,
      )
    }
  }

  const authorization = request.headers.get('authorization')
  const personalKey = authorization?.match(/^Bearer (.+)$/i)?.[1]?.trim()
  if (authorization !== null && !bodyByokConfig && (!personalKey || !isPersonalKey(personalKey))) {
    return json({ error: 'Check your OpenAI API key in Settings.' }, 400, corsHeaders)
  }

  const isLegacyAuthHeader = Boolean(personalKey && !bodyByokConfig)
  const activeByok: ByokConfig | null = bodyByokConfig ?? (
    personalKey
      ? {
          provider: 'openai',
          apiKey: personalKey,
          model: env?.OPENAI_MODEL?.trim() || readProcessEnv('OPENAI_MODEL') || DEFAULT_OPENAI_MODEL,
        }
      : null
  )

  const workersAi = !activeByok ? env?.AI : undefined
  const fallbackOpenAiKey = env?.OPENAI_API_KEY?.trim() || readProcessEnv('OPENAI_API_KEY')
  const serverOpenAiKey = !activeByok && !workersAi ? fallbackOpenAiKey : undefined

  if (!activeByok && !workersAi && !serverOpenAiKey) {
    return json(
      { error: 'AI passage generation is unavailable right now. Try free passages or check Settings.' },
      503,
      corsHeaders,
    )
  }

  const resolvedClientKey = resolveClientKey(request, clientKey)
  const visitorIdentity = await resolveVisitorIdentity(request, resolvedClientKey, env)
  if (visitorIdentity.setCookieHeader) {
    corsHeaders.set('Set-Cookie', visitorIdentity.setCookieHeader)
  }

  const turnstileSecret = env?.TURNSTILE_SECRET_KEY?.trim() || readProcessEnv('TURNSTILE_SECRET_KEY')
  if (turnstileSecret) {
    const turnstileToken = request.headers.get('cf-turnstile-response')?.trim() || parsed.data.turnstileToken
    if (!turnstileToken) {
      return json({ error: 'Complete the security check to generate a passage.' }, 403, corsHeaders)
    }
    const verified = await verifyTurnstileToken(turnstileSecret, turnstileToken, resolvedClientKey, request.signal)
    if (request.signal.aborted) return json({ error: 'Generation was canceled.' }, 499, corsHeaders)
    if (!verified) {
      return json({ error: 'Security verification failed. Refresh and try again.' }, 403, corsHeaders)
    }
  }

  const enforceSingleFlightPerIp = !visitorIdentity.hasValidCookie
  if (
    (enforceSingleFlightPerIp && activeClients.has(resolvedClientKey))
    || activeClients.size >= MAX_CONCURRENT_GENERATIONS
  ) {
    const busyHeaders = new Headers(corsHeaders)
    busyHeaders.set('Retry-After', '2')
    return json({ error: 'Passage generation is busy. Try again in a moment.' }, 429, busyHeaders)
  }

  if (env?.PASSAGE_RATE_LIMITER) {
    const { success } = await env.PASSAGE_RATE_LIMITER.limit({ key: resolvedClientKey })
    if (!success) {
      const rateHeaders = new Headers(corsHeaders)
      rateHeaders.set('Retry-After', '60')
      return json({ error: 'Too many requests. Try again shortly.' }, 429, rateHeaders)
    }
  } else {
    const now = Date.now()
    if (now >= windowEndsAt) {
      windowEndsAt = now + WINDOW_MS
      requestsByClient.clear()
    }
    const requests = requestsByClient.get(resolvedClientKey) ?? 0
    if (requests >= REQUESTS_PER_WINDOW || (!requests && requestsByClient.size >= MAX_RATE_LIMIT_KEYS)) {
      const rateHeaders = new Headers(corsHeaders)
      rateHeaders.set('Retry-After', String(Math.max(1, Math.ceil((windowEndsAt - now) / 1000))))
      return json({ error: 'Too many requests. Try again shortly.' }, 429, rateHeaders)
    }
    requestsByClient.set(resolvedClientKey, requests + 1)
  }

  const day = currentKolkataDay()
  let quotaReserved = false

  if (!activeByok) {
    const reservation = await reserveQuotaSlot(visitorIdentity.visitorKey, day, env)
    if (!reservation.allowed) {
      return json(
        {
          error:
            "You've used your 5 free generations for today. Use Free passages anytime, or connect your own API key in Settings.",
          code: 'DAILY_QUOTA_EXHAUSTED',
          quota: toQuotaSummary(reservation),
        },
        429,
        corsHeaders,
      )
    }
    quotaReserved = true
  }

  if (enforceSingleFlightPerIp) {
    activeClients.add(resolvedClientKey)
  }

  const activeModel = activeByok
    ? activeByok.model
    : workersAi
      ? resolveWorkersAiModel(env)
      : (env?.OPENAI_MODEL?.trim() || readProcessEnv('OPENAI_MODEL') || DEFAULT_OPENAI_MODEL)

  const timeout = new AbortController()
  const deadline = setTimeout(() => timeout.abort(), GENERATION_TIMEOUT_MS)
  try {
    const signal = AbortSignal.any([request.signal, timeout.signal])
    const passage = activeByok
      ? await generateByokPassage({
          topic: parsed.data.topic,
          duration: parsed.data.duration,
          config: activeByok,
          maxOutputTokens: maxTokensForDuration(parsed.data.duration),
          signal,
          readJson,
          parseText: parsePassageText,
          readFallback: readWorkersAiPassage,
        })
      : workersAi
        ? await generateWorkersAiPassage(parsed.data, workersAi, activeModel, signal)
        : await generateOpenAiPassage(parsed.data, serverOpenAiKey!, activeModel, signal)

    if (passage !== null) {
      let quotaSummary: QuotaSummary
      if (quotaReserved) {
        const committed = await commitQuotaSlot(visitorIdentity.visitorKey, day, env)
        quotaReserved = false
        quotaSummary = toQuotaSummary(committed)
      } else {
        const currentQuota = await getQuotaStatus(visitorIdentity.visitorKey, day, env)
        quotaSummary = toQuotaSummary(currentQuota)
      }

      return json(
        {
          passage,
          model: activeModel,
          provider: activeByok ? activeByok.provider : 'shared',
          wordCount: countWords(passage),
          characterCount: splitGraphemes(passage).length,
          quota: quotaSummary,
        },
        200,
        corsHeaders,
      )
    }
  } catch (error) {
    if (request.signal.aborted) return json({ error: 'Generation was canceled.' }, 499, corsHeaders)
    if (timeout.signal.aborted) return json({ error: 'Generation took too long. Try again.' }, 504, corsHeaders)
    if (error instanceof ProviderQuotaError) {
      return json(
        { error: 'The daily free AI quota has been reached. Try free passages or try again tomorrow.' },
        429,
        corsHeaders,
      )
    }
    if (activeByok && error instanceof ProviderAuthenticationError) {
      const message = isLegacyAuthHeader
        ? 'OpenAI rejected your key or its permissions. Check Settings.'
        : `${error.providerName} rejected your API key or its permissions. Check Settings.`
      return json({ error: message }, 401, corsHeaders)
    }
  } finally {
    clearTimeout(deadline)
    if (enforceSingleFlightPerIp) {
      activeClients.delete(resolvedClientKey)
    }
    if (quotaReserved) {
      await releaseQuotaSlot(visitorIdentity.visitorKey, day, env).catch(() => undefined)
    }
  }
  return json({ error: 'Could not generate a passage. Try again.' }, 502, corsHeaders)
}

export async function handleWorkerRequest(request: Request, env?: PassageEnv): Promise<Response> {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  } catch {
    return json({ error: 'Invalid request URL.' }, 400)
  }

  if (pathname === '/api/generate-passage' || pathname === '/api/passage') {
    return handlePassage(request, undefined, env)
  }
  if (pathname === '/api/quota') {
    return handleQuota(request, undefined, env)
  }
  if (pathname === '/api/health') {
    return handleHealth(request, env)
  }
  return json({ error: 'Not found.' }, 404)
}
