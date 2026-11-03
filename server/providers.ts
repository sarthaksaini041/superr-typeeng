import {
  AI_PROVIDER_BY_ID,
  validateByokConfig,
  type AiProviderId,
  type AiProviderSpec,
  type ByokConfig,
} from '../src/shared/personal-key.ts'
import { PASSAGE_LIMITS, type Duration } from '../src/shared/passage.ts'
import { buildPassageUserPrompt, PASSAGE_SYSTEM_PROMPT } from './system-prompt.ts'

export {
  AI_PROVIDER_BY_ID,
  validateByokConfig,
  type AiProviderId,
  type AiProviderSpec,
  type ByokConfig,
}

const PROVIDER_BYTES = 65536

const jsonSchemaDefinition = {
  name: 'typing_passage',
  strict: true,
  schema: {
    type: 'object',
    properties: { passage: { type: 'string' } },
    required: ['passage'],
    additionalProperties: false,
  },
}

export const workersAiResponseFormat = {
  type: 'json_schema',
  json_schema: jsonSchemaDefinition,
}

export const openAiResponsesFormat = {
  type: 'json_schema',
  ...jsonSchemaDefinition,
}

const OPENAI_COMPATIBLE_ENDPOINTS: Record<
  Exclude<AiProviderId, 'google' | 'anthropic' | 'cloudflare'>,
  string
> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  together: 'https://api.together.xyz/v1/chat/completions',
  fireworks: 'https://api.fireworks.ai/inference/v1/chat/completions',
}

export class ProviderAuthenticationError extends Error {
  readonly providerName: string

  constructor(providerName = 'OpenAI') {
    super(`${providerName} authentication failed`)
    this.name = 'ProviderAuthenticationError'
    this.providerName = providerName
  }
}

export class ProviderQuotaError extends Error {
  readonly providerName: string

  constructor(providerName = 'AI provider') {
    super(`${providerName} rate limit or quota exceeded`)
    this.name = 'ProviderQuotaError'
    this.providerName = providerName
  }
}

export function parseRequestByokConfig(rawProvider: unknown): ByokConfig | null {
  if (typeof rawProvider !== 'object' || rawProvider === null) return null
  const record = rawProvider as Record<string, unknown>
  const normalized = {
    provider: record.provider ?? record.id,
    apiKey: record.apiKey,
    model: record.model,
    accountId: record.accountId,
  }
  return validateByokConfig(normalized)
}

export interface ProviderRequestSpec {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

export function buildByokProviderRequest(
  config: ByokConfig,
  {
    topic,
    duration,
    retry,
    maxOutputTokens,
  }: {
    topic: string
    duration: Duration
    retry: boolean
    maxOutputTokens: number
  },
): ProviderRequestSpec {
  const userPrompt = buildPassageUserPrompt(topic, duration, retry)

  if (config.provider === 'google') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey,
      },
      body: {
        systemInstruction: {
          parts: [{ text: PASSAGE_SYSTEM_PROMPT }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens,
          responseMimeType: 'application/json',
        },
      },
    }
  }

  if (config.provider === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: config.model,
        max_tokens: maxOutputTokens,
        temperature: 0.7,
        system: PASSAGE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      },
    }
  }

  if (config.provider === 'cloudflare') {
    const accountId = config.accountId ?? ''
    return {
      url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${config.model}`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: {
        messages: [
          { role: 'system', content: PASSAGE_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        chat_template_kwargs: { enable_thinking: false },
        max_tokens: maxOutputTokens,
        temperature: 0.7,
        response_format: workersAiResponseFormat,
      },
    }
  }

  if (config.provider === 'openai' && config.model === 'gpt-6-luna') {
    const { minChars, maxChars, minWords, maxWords } = PASSAGE_LIMITS[duration]
    return {
      url: 'https://api.openai.com/v1/responses',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: {
        model: config.model,
        store: false,
        reasoning: { effort: 'none' },
        instructions: PASSAGE_SYSTEM_PROMPT,
        input: JSON.stringify({
          topic,
          length: { minChars, maxChars, minWords, maxWords },
          ...(retry
            ? {
                guidance:
                  'A prior answer failed validation. Generate a fresh passage and prioritize the required character bounds.',
              }
            : {}),
        }),
        text: { format: openAiResponsesFormat },
        max_output_tokens: Math.ceil(maxChars / 2) + 128,
      },
    }
  }

  const endpoint = OPENAI_COMPATIBLE_ENDPOINTS[config.provider]
  return {
    url: endpoint,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: {
      model: config.model,
      messages: [
        { role: 'system', content: PASSAGE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxOutputTokens,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    },
  }
}

export function extractByokProviderPassage(
  value: unknown,
  duration: Duration,
  parseText: (text: string, duration: Duration) => string | null,
  readFallback: (value: unknown, duration: Duration) => string | null,
): string | null {
  if (value && typeof value === 'object') {
    // Google Gemini shape: candidates[0].content.parts[0].text
    if ('candidates' in value && Array.isArray((value as { candidates?: unknown }).candidates)) {
      const candidates = (value as { candidates: unknown[] }).candidates
      const first = candidates[0]
      if (first && typeof first === 'object' && 'content' in first) {
        const content = (first as { content?: unknown }).content
        if (content && typeof content === 'object' && 'parts' in content && Array.isArray((content as { parts?: unknown }).parts)) {
          const parts = (content as { parts: unknown[] }).parts
          for (const part of parts) {
            if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') {
              const parsed = parseText((part as { text: string }).text, duration)
              if (parsed !== null) return parsed
            }
          }
        }
      }
    }

    // Anthropic Claude shape: content[{ type: 'text', text: '...' }]
    if ('content' in value && Array.isArray((value as { content?: unknown }).content)) {
      const blocks = (value as { content: unknown[] }).content
      for (const block of blocks) {
        if (
          block
          && typeof block === 'object'
          && (block as { type?: unknown }).type === 'text'
          && typeof (block as { text?: unknown }).text === 'string'
        ) {
          const parsed = parseText((block as { text: string }).text, duration)
          if (parsed !== null) return parsed
        }
      }
    }
  }

  return readFallback(value, duration)
}

export async function generateByokPassage(
  {
    topic,
    duration,
    config,
    maxOutputTokens,
    signal,
    readJson,
    parseText,
    readFallback,
  }: {
    topic: string
    duration: Duration
    config: ByokConfig
    maxOutputTokens: number
    signal: AbortSignal
    readJson: (message: Response, maxBytes: number) => Promise<unknown>
    parseText: (text: string, duration: Duration) => string | null
    readFallback: (value: unknown, duration: Duration) => string | null
  },
): Promise<string | null> {
  const providerSpec = AI_PROVIDER_BY_ID[config.provider]

  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal.throwIfAborted()
    const requestSpec = buildByokProviderRequest(config, {
      topic,
      duration,
      retry: attempt > 0,
      maxOutputTokens,
    })

    const response = await fetch(requestSpec.url, {
      method: 'POST',
      redirect: 'error',
      headers: requestSpec.headers,
      signal,
      body: JSON.stringify(requestSpec.body),
    })
    signal.throwIfAborted()

    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthenticationError(providerSpec.name)
      }
      if (response.status === 429) {
        throw new ProviderQuotaError(providerSpec.name)
      }
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

    const passage = extractByokProviderPassage(value, duration, parseText, readFallback)
    if (passage !== null) return passage
  }

  return null
}
