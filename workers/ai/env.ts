import type { QuotaDurableObjectNamespaceLike } from '../../server/quota.ts'

export interface AiBinding {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>
}

export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export interface Env {
  AI?: Ai | AiBinding
  AI_MODEL?: string
  ALLOWED_ORIGINS?: string
  PASSAGE_RATE_LIMITER?: RateLimiterBinding
  QUOTA_DO?: DurableObjectNamespace | QuotaDurableObjectNamespaceLike
  VISITOR_COOKIE_SECRET?: string
  TURNSTILE_SECRET_KEY?: string
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
}
