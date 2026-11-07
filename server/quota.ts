export const DAILY_FREE_LIMIT = 5
export const QUOTA_TIME_ZONE = 'Asia/Kolkata'
export const VISITOR_COOKIE_NAME = 'superr_visitor'

const VISITOR_COOKIE_MAX_AGE = 31_536_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/

const kolkataDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: QUOTA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export interface QuotaSummary {
  limit: number
  used: number
  remaining: number
  resetsAt: string
}

export interface QuotaStatus extends QuotaSummary {
  day: string
}

export interface QuotaReservation extends QuotaStatus {
  allowed: boolean
}

export interface QuotaEndpointPayload extends QuotaSummary {
  timeZone: typeof QUOTA_TIME_ZONE
}

export interface QuotaRecord {
  day: string
  used: number
  inFlight: number
}

export interface QuotaStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>
  put<T = unknown>(key: string, value: T): Promise<void>
}

export interface QuotaDurableObjectStateLike {
  storage: QuotaStorageLike
  blockConcurrencyWhile?<T>(callback: () => Promise<T>): Promise<T>
}

export interface QuotaDurableObjectStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export interface QuotaDurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): QuotaDurableObjectStubLike
}

export interface QuotaEnv {
  QUOTA_DO?: QuotaDurableObjectNamespaceLike
  VISITOR_COOKIE_SECRET?: string
}

export interface VisitorIdentity {
  visitorKey: string
  hasValidCookie: boolean
  setCookieHeader: string | null
}

type QuotaAction = 'status' | 'reserve' | 'commit' | 'release'

interface QuotaDoRequest {
  action: QuotaAction
  day: string
}

const memoryQuotaStore = new Map<string, QuotaRecord>()
const hmacKeyCache = new Map<string, Promise<CryptoKey>>()
let fallbackCookieSecret: string | undefined

function getFallbackCookieSecret(): string {
  if (!fallbackCookieSecret) {
    fallbackCookieSecret = `${crypto.randomUUID()}-${crypto.randomUUID()}`
  }
  return fallbackCookieSecret
}

export function resetQuotaStoreForTests(): void {
  memoryQuotaStore.clear()
}

export function currentKolkataDay(now: Date = new Date()): string {
  return kolkataDayFormatter.format(now)
}

export function resetsAtForKolkataDay(day: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!parts) {
    return nextKolkataMidnightIso(new Date())
  }
  const year = Number(parts[1])
  const month = Number(parts[2])
  const dayOfMonth = Number(parts[3])
  const nextUtcDate = new Date(Date.UTC(year, month - 1, dayOfMonth + 1))
  const nextYear = String(nextUtcDate.getUTCFullYear()).padStart(4, '0')
  const nextMonth = String(nextUtcDate.getUTCMonth() + 1).padStart(2, '0')
  const nextDay = String(nextUtcDate.getUTCDate()).padStart(2, '0')
  return new Date(`${nextYear}-${nextMonth}-${nextDay}T00:00:00+05:30`).toISOString()
}

export function nextKolkataMidnightIso(now: Date = new Date()): string {
  return resetsAtForKolkataDay(currentKolkataDay(now))
}

export function toQuotaSummary(status: QuotaSummary): QuotaSummary {
  return {
    limit: status.limit,
    used: status.used,
    remaining: status.remaining,
    resetsAt: status.resetsAt,
  }
}

function resolveCookieSecret(env?: QuotaEnv): string {
  const configured = env?.VISITOR_COOKIE_SECRET?.trim() || (typeof process !== 'undefined' ? process.env?.VISITOR_COOKIE_SECRET?.trim() : undefined)
  return configured || getFallbackCookieSecret()
}

function getHmacKey(secret: string): Promise<CryptoKey> {
  let cached = hmacKeyCache.get(secret)
  if (!cached) {
    const encoder = new TextEncoder()
    cached = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    )
    hmacKeyCache.set(secret, cached)
  }
  return cached
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!SIGNATURE_PATTERN.test(value)) return null
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}

export async function signVisitorId(visitorId: string, env?: QuotaEnv): Promise<string> {
  const key = await getHmacKey(resolveCookieSecret(env))
  const data = new TextEncoder().encode(visitorId)
  const signature = await crypto.subtle.sign('HMAC', key, data)
  return `${visitorId}.${toBase64Url(new Uint8Array(signature))}`
}

export async function verifyVisitorCookieValue(cookieValue: string, env?: QuotaEnv): Promise<string | null> {
  const dotIndex = cookieValue.indexOf('.')
  if (dotIndex <= 0 || dotIndex !== cookieValue.lastIndexOf('.')) return null
  const visitorId = cookieValue.slice(0, dotIndex)
  const rawSignature = cookieValue.slice(dotIndex + 1)
  if (!UUID_PATTERN.test(visitorId)) return null
  const signatureBytes = fromBase64Url(rawSignature)
  if (!signatureBytes) return null

  const key = await getHmacKey(resolveCookieSecret(env))
  const data = new TextEncoder().encode(visitorId)
  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes as BufferSource, data)
  return valid ? visitorId.toLowerCase() : null
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex <= 0) continue
    const key = trimmed.slice(0, eqIndex).trim()
    if (key !== name) continue
    const value = trimmed.slice(eqIndex + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  return null
}

function formatVisitorSetCookie(signedValue: string, request: Request): string {
  let isHttps: boolean
  try {
    isHttps = new URL(request.url, 'http://localhost').protocol === 'https:'
  } catch {
    isHttps = false
  }
  const attributes = [
    `${VISITOR_COOKIE_NAME}=${signedValue}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${VISITOR_COOKIE_MAX_AGE}`,
  ]
  if (isHttps) attributes.push('Secure')
  return attributes.join('; ')
}

export async function resolveVisitorIdentity(
  request: Request,
  clientKey: string,
  env?: QuotaEnv,
): Promise<VisitorIdentity> {
  const normalizedIp = (clientKey || 'unknown').trim() || 'unknown'
  const ipKey = `ip:${normalizedIp}`
  const rawCookie = readCookie(request.headers.get('cookie'), VISITOR_COOKIE_NAME)
  if (rawCookie) {
    const verifiedId = await verifyVisitorCookieValue(rawCookie, env)
    if (verifiedId) {
      return {
        visitorKey: ipKey,
        hasValidCookie: true,
        setCookieHeader: null,
      }
    }
  }

  const newVisitorId = crypto.randomUUID().toLowerCase()
  const signedValue = await signVisitorId(newVisitorId, env)
  return {
    visitorKey: ipKey,
    hasValidCookie: false,
    setCookieHeader: formatVisitorSetCookie(signedValue, request),
  }
}

function applyQuotaAction(record: QuotaRecord, action: QuotaAction, day: string) {
  if (record.day !== day) {
    record.day = day
    record.used = 0
    record.inFlight = 0
  }

  const resetsAt = resetsAtForKolkataDay(day)

  if (action === 'status') {
    const remaining = Math.max(0, DAILY_FREE_LIMIT - record.used - record.inFlight)
    return {
      limit: DAILY_FREE_LIMIT,
      used: record.used,
      remaining,
      day,
      resetsAt,
    } satisfies QuotaStatus
  }

  if (action === 'reserve') {
    if (record.used + record.inFlight >= DAILY_FREE_LIMIT) {
      return {
        allowed: false,
        limit: DAILY_FREE_LIMIT,
        used: record.used,
        remaining: 0,
        day,
        resetsAt,
      } satisfies QuotaReservation
    }
    record.inFlight += 1
    const remaining = Math.max(0, DAILY_FREE_LIMIT - record.used - record.inFlight)
    return {
      allowed: true,
      limit: DAILY_FREE_LIMIT,
      used: record.used,
      remaining,
      day,
      resetsAt,
    } satisfies QuotaReservation
  }

  if (action === 'commit') {
    if (record.inFlight > 0) {
      record.inFlight -= 1
    }
    record.used = Math.min(DAILY_FREE_LIMIT, record.used + 1)
    const remaining = Math.max(0, DAILY_FREE_LIMIT - record.used - record.inFlight)
    return {
      limit: DAILY_FREE_LIMIT,
      used: record.used,
      remaining,
      day,
      resetsAt,
    } satisfies QuotaStatus
  }

  // action === 'release'
  if (record.inFlight > 0) {
    record.inFlight -= 1
  }
  const remaining = Math.max(0, DAILY_FREE_LIMIT - record.used - record.inFlight)
  return {
    limit: DAILY_FREE_LIMIT,
    used: record.used,
    remaining,
    day,
    resetsAt,
  } satisfies QuotaStatus
}

function getMemoryRecord(visitorKey: string, day: string): QuotaRecord {
  let record = memoryQuotaStore.get(visitorKey)
  if (!record || record.day !== day) {
    record = { day, used: 0, inFlight: 0 }
    memoryQuotaStore.set(visitorKey, record)
  }
  return record
}

async function callQuotaDurableObject<T>(
  namespace: QuotaDurableObjectNamespaceLike,
  visitorKey: string,
  payload: QuotaDoRequest,
): Promise<T> {
  const id = namespace.idFromName(visitorKey)
  const stub = namespace.get(id)
  const response = await stub.fetch('https://quota.internal/quota', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`Quota Durable Object failed with status ${response.status}`)
  }
  return (await response.json()) as T
}

export async function getQuotaStatus(
  visitorKey: string,
  day: string = currentKolkataDay(),
  env?: QuotaEnv,
): Promise<QuotaStatus> {
  if (env?.QUOTA_DO) {
    return callQuotaDurableObject<QuotaStatus>(env.QUOTA_DO, visitorKey, { action: 'status', day })
  }
  const record = getMemoryRecord(visitorKey, day)
  return applyQuotaAction(record, 'status', day) as QuotaStatus
}

export async function reserveQuotaSlot(
  visitorKey: string,
  day: string = currentKolkataDay(),
  env?: QuotaEnv,
): Promise<QuotaReservation> {
  if (env?.QUOTA_DO) {
    return callQuotaDurableObject<QuotaReservation>(env.QUOTA_DO, visitorKey, { action: 'reserve', day })
  }
  const record = getMemoryRecord(visitorKey, day)
  return applyQuotaAction(record, 'reserve', day) as QuotaReservation
}

export async function commitQuotaSlot(
  visitorKey: string,
  day: string = currentKolkataDay(),
  env?: QuotaEnv,
): Promise<QuotaStatus> {
  if (env?.QUOTA_DO) {
    return callQuotaDurableObject<QuotaStatus>(env.QUOTA_DO, visitorKey, { action: 'commit', day })
  }
  const record = getMemoryRecord(visitorKey, day)
  return applyQuotaAction(record, 'commit', day) as QuotaStatus
}

export async function releaseQuotaSlot(
  visitorKey: string,
  day: string = currentKolkataDay(),
  env?: QuotaEnv,
): Promise<QuotaStatus> {
  if (env?.QUOTA_DO) {
    return callQuotaDurableObject<QuotaStatus>(env.QUOTA_DO, visitorKey, { action: 'release', day })
  }
  const record = getMemoryRecord(visitorKey, day)
  return applyQuotaAction(record, 'release', day) as QuotaStatus
}

export class DailyQuotaDurableObject {
  private readonly state: QuotaDurableObjectStateLike
  private record: QuotaRecord | null = null

  constructor(state: QuotaDurableObjectStateLike) {
    this.state = state
  }

  private async ensureRecord(day: string): Promise<QuotaRecord> {
    if (!this.record) {
      const stored = await this.state.storage.get<QuotaRecord>('quota')
      this.record = stored ?? { day, used: 0, inFlight: 0 }
    }
    if (this.record.day !== day) {
      this.record = { day, used: 0, inFlight: 0 }
    }
    return this.record
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    const body = (await request.json()) as QuotaDoRequest
    const run = async () => {
      const record = await this.ensureRecord(body.day)
      const result = applyQuotaAction(record, body.action, body.day)
      if (body.action !== 'status') {
        await this.state.storage.put('quota', record)
      }
      return result
    }

    const result = this.state.blockConcurrencyWhile
      ? await this.state.blockConcurrencyWhile(run)
      : await run()

    return Response.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
