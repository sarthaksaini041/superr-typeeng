import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearByokConfig,
  readByokConfig,
  readPersonalKey,
  saveByokConfig,
  savePersonalKey,
} from '../personal-key-storage'
import { DURATIONS, PASSAGE_LIMITS } from './passage'
import {
  AI_PROVIDER_BY_ID,
  AI_PROVIDER_IDS,
  AI_PROVIDERS,
  DAILY_FREE_GENERATION_LIMIT,
  formatRemainingQuota,
  isAiProviderId,
  isPersonalKey,
  maskApiKey,
  MAX_PERSONAL_KEY_LENGTH,
  QUOTA_TIME_ZONE,
  validateByokConfig,
  validateCloudflareAccountId,
  validateProviderApiKey,
} from './personal-key'
import {
  chooseSample,
  getSampleById,
  listSamples,
   SAMPLE_CATEGORIES,
  sampleForDuration,
  samples,
} from './sample-catalog'
import { starterPassage, starterTopic } from './starter'

describe('sample catalog', () => {
  it('has 100 distinct samples with sentence-aligned versions for all six durations', () => {
    expect(samples).toHaveLength(100)
    expect(new Set(samples.map(sample => sample.passage)).size).toBe(samples.length)
    expect(new Set(samples.map(sample => sample.id)).size).toBe(samples.length)
    expect(new Set(samples.map(sample => sample.title)).size).toBe(samples.length)

    const validCategories = new Set(SAMPLE_CATEGORIES.filter(category => category !== 'All'))
    for (const sample of samples) {
      expect(validCategories.has(sample.category)).toBe(true)
      expect(sample.title).not.toMatch(/Excerpt \d+/i)
      expect(sample.source.length).toBeGreaterThan(0)
      expect(sample.preview.length).toBeGreaterThanOrEqual(20)
      expect(sample.passage).toMatch(/^[ -~]+$/)
      for (const duration of DURATIONS) {
        const passage = sampleForDuration(sample.passage, duration)
        const limits = PASSAGE_LIMITS[duration]
        expect(passage.length, `${sample.title} at ${duration}s`).toBeGreaterThanOrEqual(limits.minChars)
        expect(passage.length).toBeLessThanOrEqual(limits.maxChars)
        expect(sample.passage.startsWith(passage)).toBe(true)
        expect(passage).toMatch(/[.!?]["')\]]*$/)
      }
    }
  })

  it('draws from the entire catalog and excludes the previous draw', () => {
    const random = vi.spyOn(Math, 'random')
    try {
      random.mockReturnValue(0)
      expect(chooseSample(30, null)).toMatchObject({ index: 0, passage: starterPassage(30) })
      expect(chooseSample(30, 0).index).toBe(1)
      random.mockReturnValue(0.999999)
      expect(chooseSample(180, null).index).toBe(99)
      expect(chooseSample(180, 99).index).toBe(98)
    } finally {
      random.mockRestore()
    }
  })

  it('lists samples filtered by category, duration, and search query, and resolves samples by ID', () => {
    const all30 = listSamples({ category: 'All', duration: 30 })
    expect(all30).toHaveLength(100)
    expect(all30[0]).toMatchObject({
      id: 1,
      title: starterTopic,
      category: 'Everyday & Modern',
      duration: 30,
      characterCount: starterPassage(30).length,
    })

    for (const category of SAMPLE_CATEGORIES) {
      if (category === 'All') continue
      const filtered = listSamples({ category, duration: 60 })
      expect(filtered.length).toBeGreaterThan(0)
      expect(filtered.every(item => item.category === category && item.duration === 60)).toBe(true)
    }

    const sciFi = listSamples({ category: 'Science Fiction', query: 'Time Machine', duration: 90 })
    expect(sciFi).toHaveLength(7)
    expect(sciFi.every(item => item.source === 'The Time Machine')).toBe(true)

    const byId = getSampleById(sciFi[0].id, 90)
    expect(byId.id).toBe(sciFi[0].id)
    expect(byId.title).toBe('The Fourth Dimension Explained')
    expect(byId.source).toBe('The Time Machine')
    expect(byId.category).toBe('Science Fiction')
    expect(byId.characterCount).toBe(byId.passage.length)
    expect(byId.wordCount).toBe(sciFi[0].wordCount)

    const fallback = getSampleById(999_999, 45)
    expect(fallback.index).toBe(0)
    expect(fallback.id).toBe(1)
    expect(fallback.passage).toBe(starterPassage(45))
  })
})

function createMockStorage() {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear: vi.fn(() => store.clear()),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value))
    }),
  }
}

describe('BYOK provider catalog and in-memory key storage', () => {
  let mockLocalStorage: ReturnType<typeof createMockStorage>
  let mockSessionStorage: ReturnType<typeof createMockStorage>

  beforeEach(() => {
    mockLocalStorage = createMockStorage()
    mockSessionStorage = createMockStorage()
    vi.stubGlobal('localStorage', mockLocalStorage)
    vi.stubGlobal('sessionStorage', mockSessionStorage)
    clearByokConfig()
  })

  it('defines all 10 providers with valid models and metadata', () => {
    expect(AI_PROVIDER_IDS).toEqual([
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
    ])
    expect(AI_PROVIDERS).toHaveLength(10)
    expect(DAILY_FREE_GENERATION_LIMIT).toBe(5)
    expect(QUOTA_TIME_ZONE).toBe('Asia/Kolkata')

    for (const id of AI_PROVIDER_IDS) {
      expect(isAiProviderId(id)).toBe(true)
      const spec = AI_PROVIDER_BY_ID[id]
      expect(spec.id).toBe(id)
      expect(spec.models.some(model => model.id === spec.defaultModel)).toBe(true)
      expect(spec.keyUrl).toMatch(/^https:\/\//)
    }
    expect(isAiProviderId('unknown')).toBe(false)
    expect(AI_PROVIDER_BY_ID.cloudflare.requiresAccountId).toBe(true)
  })

  it('validates provider API keys, Cloudflare account IDs, and BYOK configs', () => {
    expect(validateProviderApiKey('openai', 'sk-proj-1234567890')).toBe(true)
    expect(validateProviderApiKey('anthropic', 'sk-ant-api03-1234567890')).toBe(true)
    expect(validateProviderApiKey('google', 'AIzaSyA1234567890abcdef')).toBe(true)
    expect(validateProviderApiKey('openrouter', 'sk-or-v1-1234567890abcdef')).toBe(true)
    expect(validateProviderApiKey('groq', 'gsk_1234567890abcdef')).toBe(true)
    expect(validateProviderApiKey('mistral', 'mistral-key-12345678')).toBe(true)
    expect(validateProviderApiKey('deepseek', 'sk-deepseek-12345678')).toBe(true)
    expect(validateProviderApiKey('together', 'tgp_v1_1234567890')).toBe(true)
    expect(validateProviderApiKey('fireworks', 'fw_1234567890abcdef')).toBe(true)
    expect(validateProviderApiKey('cloudflare', 'cfut_1234567890abcdef')).toBe(true)

    expect(validateProviderApiKey('openai', ' sk-proj-1234567890 ')).toBe(false)
    expect(validateProviderApiKey('openai', 'sk-short')).toBe(false)
    expect(validateProviderApiKey('openai', `sk-${'a'.repeat(MAX_PERSONAL_KEY_LENGTH)}`)).toBe(false)
    expect(isPersonalKey('sk-1234567890')).toBe(true)

    expect(validateCloudflareAccountId('0123456789abcdef0123456789abcdef')).toBe(true)
    expect(validateCloudflareAccountId('cf-account-12345')).toBe(true)
    expect(validateCloudflareAccountId('short')).toBe(false)
    expect(validateCloudflareAccountId(undefined)).toBe(false)

    expect(
      validateByokConfig({
        provider: 'google',
        apiKey: 'AIzaSyA1234567890abcdef',
        model: '',
      }),
    ).toEqual({
      provider: 'google',
      apiKey: 'AIzaSyA1234567890abcdef',
      model: 'gemini-2.5-flash',
    })

    expect(
      validateByokConfig({
        provider: 'cloudflare',
        apiKey: 'cfut_1234567890abcdef',
        model: '@cf/google/gemma-4-26b-a4b-it',
      }),
    ).toBeNull()

    expect(
      validateByokConfig({
        provider: 'cloudflare',
        apiKey: 'cfut_1234567890abcdef',
        model: '@cf/google/gemma-4-26b-a4b-it',
        accountId: '0123456789abcdef0123456789abcdef',
      }),
    ).toEqual({
      provider: 'cloudflare',
      apiKey: 'cfut_1234567890abcdef',
      model: '@cf/google/gemma-4-26b-a4b-it',
      accountId: '0123456789abcdef0123456789abcdef',
    })

    expect(maskApiKey('sk-1234567890abcdef')).toBe('sk-1••••')
    expect(maskApiKey('short')).toBe('••••••••')

    expect(formatRemainingQuota(5)).toBe('5 free generations remaining today')
    expect(formatRemainingQuota(1)).toBe('1 free generation remaining today')
    expect(formatRemainingQuota(0)).toBe("You've used your 5 free generations for today.")
  })

  it('stores BYOK credentials strictly in memory and scrubs legacy Web Storage keys', () => {
    mockLocalStorage.setItem('superr-typeeng.openai-key', 'sk-legacy-secret-12345')
    mockSessionStorage.setItem('superr-typeeng.openai-key', 'sk-legacy-secret-12345')
    mockLocalStorage.setItem.mockClear()
    mockSessionStorage.setItem.mockClear()

    saveByokConfig({
      provider: 'anthropic',
      apiKey: 'sk-ant-api03-1234567890',
      model: 'claude-3-5-haiku-latest',
    })

    expect(mockLocalStorage.setItem).not.toHaveBeenCalled()
    expect(mockSessionStorage.setItem).not.toHaveBeenCalled()
    expect(mockLocalStorage.getItem('superr-typeeng.openai-key')).toBeNull()
    expect(mockSessionStorage.getItem('superr-typeeng.openai-key')).toBeNull()
    expect(mockLocalStorage.length).toBe(0)
    expect(mockSessionStorage.length).toBe(0)

    expect(readByokConfig()).toEqual({
      provider: 'anthropic',
      apiKey: 'sk-ant-api03-1234567890',
      model: 'claude-3-5-haiku-latest',
    })
    expect(readPersonalKey()).toBe('sk-ant-api03-1234567890')

    savePersonalKey('sk-openai-1234567890')
    expect(mockLocalStorage.setItem).not.toHaveBeenCalled()
    expect(mockSessionStorage.setItem).not.toHaveBeenCalled()
    expect(readByokConfig()).toEqual({
      provider: 'openai',
      apiKey: 'sk-openai-1234567890',
      model: 'gpt-4o-mini',
    })

    clearByokConfig()
    expect(readByokConfig()).toBeNull()
    expect(readPersonalKey()).toBeNull()
  })
})
