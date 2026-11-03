export const AI_PROVIDER_IDS = [
  'google',
  'openai',
  'anthropic',
  'openrouter',
  'groq',
  'mistral',
  'deepseek',
  'together',
  'fireworks',
  'cloudflare',
] as const

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]

export const MAX_PERSONAL_KEY_LENGTH = 512
export const DAILY_FREE_GENERATION_LIMIT = 5
export const QUOTA_TIME_ZONE = 'Asia/Kolkata'

export interface AiProviderModel {
  id: string
  label: string
}

export interface AiProviderSpec {
  id: AiProviderId
  name: string
  placeholder: string
  keyUrl: string
  defaultModel: string
  models: readonly AiProviderModel[]
  requiresAccountId?: boolean
}

export const AI_PROVIDERS: readonly AiProviderSpec[] = [
  {
    id: 'google',
    name: 'Google Gemini',
    placeholder: 'AIza…',
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    placeholder: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    placeholder: 'sk-ant-…',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-3-5-haiku-latest',
    models: [
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
      { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    placeholder: 'sk-or-v1-…',
    keyUrl: 'https://openrouter.ai/keys',
    defaultModel: 'google/gemma-3-27b-it',
    models: [
      { id: 'google/gemma-3-27b-it', label: 'Gemma 3 27B IT' },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku' },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    placeholder: 'gsk_…',
    keyUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    placeholder: 'mistral-…',
    keyUrl: 'https://console.mistral.ai/api-keys',
    defaultModel: 'mistral-small-latest',
    models: [
      { id: 'mistral-small-latest', label: 'Mistral Small' },
      { id: 'mistral-large-latest', label: 'Mistral Large' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    placeholder: 'sk-…',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek V3 (Chat)' },
    ],
  },
  {
    id: 'together',
    name: 'Together AI',
    placeholder: 'tgp_v1_…',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Instruct Turbo' },
      { id: 'google/gemma-2-27b-it', label: 'Gemma 2 27B IT' },
    ],
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    placeholder: 'fw_…',
    keyUrl: 'https://fireworks.ai/account/api-keys',
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    models: [
      { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', label: 'Llama 3.3 70B Instruct' },
    ],
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    placeholder: 'cfut_…',
    keyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    defaultModel: '@cf/google/gemma-4-26b-a4b-it',
    models: [
      { id: '@cf/google/gemma-4-26b-a4b-it', label: 'Gemma 4 26B A4B Instruct' },
      { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B Instruct FP8' },
    ],
    requiresAccountId: true,
  },
]

export const AI_PROVIDER_BY_ID: Record<AiProviderId, AiProviderSpec> = {
  google: AI_PROVIDERS[0],
  openai: AI_PROVIDERS[1],
  anthropic: AI_PROVIDERS[2],
  openrouter: AI_PROVIDERS[3],
  groq: AI_PROVIDERS[4],
  mistral: AI_PROVIDERS[5],
  deepseek: AI_PROVIDERS[6],
  together: AI_PROVIDERS[7],
  fireworks: AI_PROVIDERS[8],
  cloudflare: AI_PROVIDERS[9],
}

export interface ByokConfig {
  provider: AiProviderId
  apiKey: string
  model: string
  accountId?: string
}

const PROVIDER_KEY_PATTERNS: Record<AiProviderId, RegExp> = {
  openai: /^sk-[A-Za-z0-9_-]{8,}$/,
  anthropic: /^sk-ant-[A-Za-z0-9_-]{8,}$/,
  google: /^AIza[A-Za-z0-9_-]{10,}$/,
  openrouter: /^sk-or-[A-Za-z0-9_-]{8,}$/,
  groq: /^gsk_[A-Za-z0-9_-]{8,}$/,
  mistral: /^[A-Za-z0-9_.:-]{8,}$/,
  deepseek: /^[A-Za-z0-9_.:-]{8,}$/,
  together: /^[A-Za-z0-9_.:-]{8,}$/,
  fireworks: /^[A-Za-z0-9_.:-]{8,}$/,
  cloudflare: /^[A-Za-z0-9_.:-]{8,}$/,
}

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && AI_PROVIDER_IDS.some(id => id === value)
}

export function validateProviderApiKey(provider: AiProviderId, key: string): boolean {
  if (!isAiProviderId(provider) || typeof key !== 'string') return false
  if (key.trim() !== key || key.length < 8 || key.length > MAX_PERSONAL_KEY_LENGTH) return false
  if (/\s/.test(key)) return false
  return PROVIDER_KEY_PATTERNS[provider].test(key)
}

export function validateCloudflareAccountId(accountId: string | undefined): boolean {
  if (typeof accountId !== 'string') return false
  const trimmed = accountId.trim()
  if (trimmed !== accountId) return false
  return /^[a-fA-F0-9]{32}$/.test(accountId) || /^[A-Za-z0-9_-]{8,64}$/.test(accountId)
}

export function validateByokConfig(value: unknown): ByokConfig | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (!isAiProviderId(record.provider)) return null
  const spec = AI_PROVIDER_BY_ID[record.provider]
  if (typeof record.apiKey !== 'string') return null
  if (!validateProviderApiKey(spec.id, record.apiKey)) return null

  let model = spec.defaultModel
  if (record.model !== undefined && record.model !== '') {
    if (typeof record.model !== 'string' || !spec.models.some(item => item.id === record.model)) {
      return null
    }
    model = record.model
  }

  if (spec.requiresAccountId) {
    const accountId = typeof record.accountId === 'string' ? record.accountId : undefined
    if (!validateCloudflareAccountId(accountId)) return null
    return {
      provider: spec.id,
      apiKey: record.apiKey,
      model,
      accountId,
    }
  }

  if (record.accountId !== undefined && record.accountId !== '') {
    const accountId = typeof record.accountId === 'string' ? record.accountId : undefined
    if (!validateCloudflareAccountId(accountId)) return null
    return {
      provider: spec.id,
      apiKey: record.apiKey,
      model,
      accountId,
    }
  }

  return {
    provider: spec.id,
    apiKey: record.apiKey,
    model,
  }
}

export function isPersonalKey(value: string): boolean {
  return validateProviderApiKey('openai', value)
}

export function maskApiKey(key: string): string {
  if (typeof key !== 'string' || key.trim().length === 0) return '••••••••'
  const trimmed = key.trim()
  if (trimmed.length <= 8) return '••••••••'
  return `${trimmed.slice(0, 4)}••••`
}

export function formatRemainingQuota(remaining: number, limit = DAILY_FREE_GENERATION_LIMIT): string {
  if (remaining <= 0) {
    return `You've used your ${limit} free generations for today.`
  }
  return `${remaining} free ${remaining === 1 ? 'generation' : 'generations'} remaining today`
}
