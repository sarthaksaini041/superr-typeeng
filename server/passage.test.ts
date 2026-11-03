import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DURATIONS, PASSAGE_LIMITS, splitGraphemes, type Duration } from '../src/shared/passage'
import { AI_PROVIDERS, type AiProviderId } from '../src/shared/personal-key'
import {
  countWords,
  handleHealth,
  handlePassage,
  handleQuota,
  handleWorkerRequest,
  isAllowedOrigin,
  maxTokensForDuration,
  MODEL_ID,
  readWorkersAiPassage,
  validatePassage,
  type PassageEnv,
  type PassageSuccessPayload,
} from './passage'
import {
  currentKolkataDay,
  DailyQuotaDurableObject,
  DAILY_FREE_LIMIT,
  nextKolkataMidnightIso,
  QUOTA_TIME_ZONE,
  resetQuotaStoreForTests,
  signVisitorId,
  verifyVisitorCookieValue,
  type QuotaStorageLike,
} from './quota'
import { buildPassageUserPrompt, PASSAGE_SYSTEM_PROMPT } from './system-prompt'
import worker from '../workers/ai/index'

const sentence = 'A quiet harbor gives the fishing boats a place to rest while a steady breeze moves across the water. '
const validPassage = (sentence.repeat(7)).trim()
let clientId = 0

function passageForDuration(duration: Duration): string {
  const { minChars } = PASSAGE_LIMITS[duration]
  const repeats = Math.ceil((minChars + 40) / sentence.length)
  return sentence.repeat(repeats).trim()
}

function expectedSuccessPayload(
  passage: string,
  model: string,
  provider: 'shared' | AiProviderId = 'shared',
  used = 1,
) {
  return {
    passage,
    model,
    provider,
    wordCount: countWords(passage),
    characterCount: splitGraphemes(passage).length,
    quota: {
      limit: DAILY_FREE_LIMIT,
      used,
      remaining: Math.max(0, DAILY_FREE_LIMIT - used),
      resetsAt: expect.any(String),
    },
  }
}

function request(
  topic: unknown,
  duration: unknown = 30,
  signal?: AbortSignal,
  url = 'https://typeeng.example/api/generate-passage',
  extraBody?: Record<string, unknown>,
) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, duration, ...extraBody }),
    signal,
  })
}

function providerResponse(value: unknown) {
  return Response.json({
    status: 'completed',
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: JSON.stringify(value) }],
    }],
  })
}

function mockSlowProvider() {
  let started: () => void = () => undefined
  const start = new Promise<void>(resolve => { started = resolve })
  const fetchMock = vi.fn<typeof fetch>((_, options) => new Promise((_, reject) => {
    options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
    started()
  }))
  vi.stubGlobal('fetch', fetchMock)
  return { start, fetchMock }
}

beforeEach(() => {
  clientId += 1
  resetQuotaStoreForTests()
  vi.stubEnv('OPENAI_API_KEY', 'test-secret')
  vi.stubEnv('OPENAI_MODEL', '')
  vi.stubEnv('AI_MODEL', '')
  vi.stubEnv('ALLOWED_ORIGINS', '')
  vi.stubEnv('TURNSTILE_SECRET_KEY', '')
  vi.stubEnv('VISITOR_COOKIE_SECRET', 'test-cookie-secret-key')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('passage validation', () => {
  it.each(DURATIONS)('checks the exact grapheme boundaries for %i seconds', duration => {
    const { minChars, maxChars } = PASSAGE_LIMITS[duration]
    const character = 'e\u0301'
    expect(validatePassage({ passage: character.repeat(minChars - 1) }, duration)).toBeNull()
    expect(validatePassage({ passage: character.repeat(minChars) }, duration)).toBe(character.repeat(minChars))
    expect(validatePassage({ passage: character.repeat(maxChars) }, duration)).toBe(character.repeat(maxChars))
    expect(validatePassage({ passage: character.repeat(maxChars + 1) }, duration)).toBeNull()
  })

  it('normalizes layout whitespace and preserves punctuation, word boundaries, and ordinary spaces', () => {
    const text = `${validPassage}  It’s clear, isn’t it?\n\tThat’s 100% all.`
    expect(validatePassage({ passage: `  ${text}  ` }, 30)).toBe(
      `${validPassage}  It’s clear, isn’t it? That’s 100% all.`,
    )
  })

  it.each([
    null,
    {},
    { passage: '' },
    { passage: '   \n\t  ' },
    { passage: 42 },
    { passage: validPassage, title: 'Title' },
    { passage: `# Heading\n${validPassage}` },
    { passage: `- Bullet point\n${validPassage}` },
    { passage: `1. Numbered item\n${validPassage}` },
    { passage: `> Blockquote\n${validPassage}` },
    { passage: `\`\`\`\n${validPassage}\n\`\`\`` },
    { passage: `<p>${validPassage}</p>` },
    { passage: `"${validPassage}"` },
    { passage: `“${validPassage}”` },
    { passage: `${validPassage}\u202e` },
    { passage: '1234567890 '.repeat(65) },
  ])('rejects malformed or formatted content %#', value => {
    expect(validatePassage(value, 30)).toBeNull()
  })

  it('parses all supported Cloudflare Workers AI output shapes and code fences', () => {
    expect(readWorkersAiPassage(JSON.stringify({ passage: validPassage }), 30)).toBe(validPassage)
    expect(readWorkersAiPassage({ passage: validPassage }, 30)).toBe(validPassage)
    expect(readWorkersAiPassage({ response: JSON.stringify({ passage: validPassage }) }, 30)).toBe(validPassage)
    expect(readWorkersAiPassage({ response: { passage: validPassage } }, 30)).toBe(validPassage)
    expect(readWorkersAiPassage({ result: { response: { passage: validPassage } } }, 30)).toBe(validPassage)
    expect(
      readWorkersAiPassage(
        { choices: [{ message: { content: JSON.stringify({ passage: validPassage }) } }] },
        30,
      ),
    ).toBe(validPassage)
    expect(
      readWorkersAiPassage(
        { choices: [{ message: { content: { passage: validPassage } } }] },
        30,
      ),
    ).toBe(validPassage)
    expect(
      readWorkersAiPassage(
        { response: `\`\`\`json\n${JSON.stringify({ passage: validPassage })}\n\`\`\`` },
        30,
      ),
    ).toBe(validPassage)
    expect(
      readWorkersAiPassage(
        { choices: [{ message: { refusal: 'Cannot fulfill', content: JSON.stringify({ passage: validPassage }) } }] },
        30,
      ),
    ).toBeNull()
    expect(readWorkersAiPassage({ response: 'not valid json' }, 30)).toBeNull()
  })
})

describe('Cloudflare Workers AI provider integration', () => {
  const key = () => `workers-ai-${clientId}`

  it('calls env.AI.run with @cf/google/gemma-4-26b-a4b-it, non-thinking mode, structured schema, and >= 1600 max_tokens for 180s', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const passage = passageForDuration(180)
    const run = vi.fn().mockResolvedValue({ response: JSON.stringify({ passage }) })
    const env: PassageEnv = { AI: { run } }

    const result = await handlePassage(request('  Harbor life  ', 180), key(), env)

    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(await result.json()).toEqual(expectedSuccessPayload(passage, MODEL_ID))

    expect(run).toHaveBeenCalledTimes(1)
    const [model, inputs] = run.mock.calls[0] as [string, Record<string, unknown>]
    expect(model).toBe('@cf/google/gemma-4-26b-a4b-it')
    expect(inputs.chat_template_kwargs).toEqual({ enable_thinking: false })
    expect(inputs.max_tokens).toBe(maxTokensForDuration(180))
    expect(Number(inputs.max_tokens)).toBeGreaterThanOrEqual(1600)
    expect(inputs.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'typing_passage',
        strict: true,
        schema: {
          type: 'object',
          properties: { passage: { type: 'string' } },
          required: ['passage'],
          additionalProperties: false,
        },
      },
    })
    expect(inputs.messages).toEqual([
      { role: 'system', content: PASSAGE_SYSTEM_PROMPT },
      { role: 'user', content: buildPassageUserPrompt('Harbor life', 180, false) },
    ])
  })

  it('supports a configurable model ID via env.AI_MODEL', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const customModel = '@cf/google/gemma-4-custom-it'
    const run = vi.fn().mockResolvedValue({ response: { passage: validPassage } })
    const env: PassageEnv = { AI: { run }, AI_MODEL: customModel }

    const result = await handlePassage(request('Harbors', 30), key(), env)
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual(expectedSuccessPayload(validPassage, customModel))
    expect(run).toHaveBeenCalledWith(customModel, expect.any(Object))
  })

  it.each([
    ['JSON string response field', { response: JSON.stringify({ passage: validPassage }) }],
    ['object response field', { response: { passage: validPassage } }],
    ['OpenAI-style choices message content', { choices: [{ message: { content: JSON.stringify({ passage: validPassage }) } }] }],
    ['fenced JSON string', { response: `\`\`\`json\n${JSON.stringify({ passage: validPassage })}\n\`\`\`` }],
  ])('accepts Workers AI output shape: %s', async (_label, mockOutput) => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const run = vi.fn().mockResolvedValue(mockOutput)
    const result = await handlePassage(request('Harbors', 30), `${key()}-${_label}`, { AI: { run } })
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual(expectedSuccessPayload(validPassage, MODEL_ID))
  })

  it('retries once when Workers AI returns a truncated or malformed response and succeeds on the second attempt', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const run = vi.fn()
      .mockResolvedValueOnce({ response: JSON.stringify({ passage: 'Too short to pass validation.' }) })
      .mockResolvedValueOnce({ response: JSON.stringify({ passage: validPassage }) })
    const env: PassageEnv = { AI: { run } }

    const result = await handlePassage(request('Harbors', 30), key(), env)
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual(expectedSuccessPayload(validPassage, MODEL_ID))
    expect(run).toHaveBeenCalledTimes(2)
    const secondCallInputs = run.mock.calls[1]?.[1] as { messages: { role: string; content: string }[] }
    expect(secondCallInputs.messages[1]?.content).toBe(buildPassageUserPrompt('Harbors', 30, true))
  })

  it('returns 502 after two invalid or malformed Workers AI responses and releases the quota slot', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const run = vi.fn().mockResolvedValue({ response: 'malformed non-json output' })
    const result = await handlePassage(request('Harbors', 30), key(), { AI: { run } })
    expect(result.status).toBe(502)
    expect(await result.json()).toEqual({ error: 'Could not generate a passage. Try again.' })
    expect(run).toHaveBeenCalledTimes(2)

    const quotaRes = await handleQuota(new Request('https://typeeng.example/api/quota'), key())
    expect(await quotaRes.json()).toMatchObject({ limit: 5, used: 0, remaining: 5 })
  })

  it('returns 429 without retrying when the daily Cloudflare Neuron quota or rate limit is exhausted', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const run = vi.fn().mockRejectedValue(new Error('Daily free AI neuron quota limit exceeded (429)'))
    const result = await handlePassage(request('Harbors', 30), key(), { AI: { run } })
    expect(result.status).toBe(429)
    expect(await result.json()).toEqual({
      error: 'The daily free AI quota has been reached. Try free passages or try again tomorrow.',
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('aborts a timed-out Workers AI call with 504', async () => {
    vi.useFakeTimers()
    vi.stubEnv('OPENAI_API_KEY', '')
    let started: () => void = () => undefined
    const start = new Promise<void>(resolve => { started = resolve })
    const run = vi.fn(() => new Promise(() => { started() }))
    const pending = handlePassage(request('Harbors', 30), key(), { AI: { run } })
    await start
    await vi.advanceTimersByTimeAsync(35_000)
    const result = await pending
    expect(result.status).toBe(504)
    expect(await result.json()).toEqual({ error: 'Generation took too long. Try again.' })
  })
})

describe('passage endpoint & OpenAI fallback', () => {
  const key = () => `test-${clientId}`

  it('sends the trimmed topic as user data and requests a bounded structured response', async () => {
    const passage = sentence.repeat(38).trim()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse({ passage }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await handlePassage(request('  Harbor life  ', 180), key())

    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(await result.json()).toEqual(expectedSuccessPayload(passage, 'gpt-6-luna'))
    const [url, options] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer test-secret' })
    const body = JSON.parse(String(options?.body))
    expect(body).toMatchObject({
      model: 'gpt-6-luna',
      store: false,
      text: { format: { type: 'json_schema', strict: true } },
      max_output_tokens: expect.any(Number),
    })
    expect(JSON.parse(body.input)).toEqual({ topic: 'Harbor life', length: PASSAGE_LIMITS[180] })
  })

  it.each<[unknown, unknown]>([
    ['', 30],
    ['  ', 30],
    ['a'.repeat(201), 30],
    ['harbors', 31],
    ['harbors', '30'],
    [null, 30],
  ])(
    'rejects invalid input %# before contacting the provider',
    async (topic, duration) => {
      const fetchMock = vi.fn<typeof fetch>()
      vi.stubGlobal('fetch', fetchMock)
      expect((await handlePassage(request(topic, duration), key())).status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it.each(['GET', 'PUT', 'DELETE'])('rejects unsupported HTTP method %s with 405', async method => {
    const req = new Request('https://typeeng.example/api/generate-passage', { method })
    const response = await handlePassage(req, key())
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST, OPTIONS')
    expect(await response.json()).toEqual({ error: 'Use POST to generate a passage.' })
  })

  it('handles OPTIONS preflight for allowed and disallowed origins', async () => {
    const allowedReq = new Request('https://typeeng.example/api/generate-passage', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    })
    const allowedRes = await handlePassage(allowedReq, key())
    expect(allowedRes.status).toBe(204)
    expect(allowedRes.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(allowedRes.headers.get('access-control-allow-methods')).toContain('POST')

    const disallowedReq = new Request('https://typeeng.example/api/generate-passage', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    })
    const disallowedRes = await handlePassage(disallowedReq, key())
    expect(disallowedRes.status).toBe(403)
  })

  it('rejects non-JSON content-type with 415 and malformed JSON with 400', async () => {
    const wrongType = new Request('https://typeeng.example/api/generate-passage', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ topic: 'Harbors', duration: 30 }),
    })
    expect((await handlePassage(wrongType, key())).status).toBe(415)

    const badJson = new Request('https://typeeng.example/api/generate-passage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"topic": "Harbors", "duration": ',
    })
    expect((await handlePassage(badJson, key())).status).toBe(400)
  })

  it('bounds the request body without relying on a content-length header', async () => {
    const response = await handlePassage(request('a'.repeat(5000)), key())
    expect(response.status).toBe(413)
  })

  it('counts topic graphemes within a separate code-unit ceiling', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValue(providerResponse({ passage: validPassage }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await handlePassage(request('e\u0301'.repeat(200)), key())).status).toBe(200)
    expect((await handlePassage(request('e\u0301'.repeat(201)), key())).status).toBe(400)
    expect((await handlePassage(request('e' + '\u0301'.repeat(600)), key())).status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects disallowed Origin headers and cross-site browser requests', async () => {
    const crossSite = request('Harbors')
    crossSite.headers.set('sec-fetch-site', 'cross-site')
    expect((await handlePassage(crossSite, key())).status).toBe(403)

    const badOrigin = request('Harbors')
    badOrigin.headers.set('Origin', 'https://untrusted.example')
    expect((await handlePassage(badOrigin, key())).status).toBe(403)

    const configuredEnv: PassageEnv = {
      ALLOWED_ORIGINS: 'https://app.typeeng.example',
      AI: { run: vi.fn().mockResolvedValue({ response: { passage: validPassage } }) },
    }
    const allowedOriginReq = request('Harbors')
    allowedOriginReq.headers.set('Origin', 'https://app.typeeng.example')
    const allowedRes = await handlePassage(allowedOriginReq, key(), configuredEnv)
    expect(allowedRes.status).toBe(200)
    expect(allowedRes.headers.get('access-control-allow-origin')).toBe('https://app.typeeng.example')
  })

  it('enforces optional Turnstile verification when TURNSTILE_SECRET_KEY is configured', async () => {
    const run = vi.fn().mockResolvedValue({ response: { passage: validPassage } })
    const env: PassageEnv = {
      AI: { run },
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
    }

    const missingTokenRes = await handlePassage(request('Harbors', 30), key(), env)
    expect(missingTokenRes.status).toBe(403)
    expect(await missingTokenRes.json()).toEqual({
      error: 'Complete the security check to generate a passage.',
    })
    expect(run).not.toHaveBeenCalled()

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ success: false }))
      .mockResolvedValueOnce(Response.json({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    const invalidTokenReq = request('Harbors', 30)
    invalidTokenReq.headers.set('cf-turnstile-response', 'bad-token')
    const invalidTokenRes = await handlePassage(invalidTokenReq, key(), env)
    expect(invalidTokenRes.status).toBe(403)
    expect(await invalidTokenRes.json()).toEqual({
      error: 'Security verification failed. Refresh and try again.',
    })
    expect(run).not.toHaveBeenCalled()

    const validTokenReq = request('Harbors', 30)
    validTokenReq.headers.set('cf-turnstile-response', 'valid-token')
    const validTokenRes = await handlePassage(validTokenReq, key(), env)
    expect(validTokenRes.status).toBe(200)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('enforces the Cloudflare PASSAGE_RATE_LIMITER binding when present', async () => {
    const run = vi.fn().mockResolvedValue({ response: { passage: validPassage } })
    const limit = vi.fn().mockResolvedValue({ success: false })
    const env: PassageEnv = {
      AI: { run },
      PASSAGE_RATE_LIMITER: { limit },
    }

    const response = await handlePassage(request('Harbors', 30), key(), env)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(await response.json()).toEqual({ error: 'Too many requests. Try again shortly.' })
    expect(limit).toHaveBeenCalledWith({ key: key() })
    expect(run).not.toHaveBeenCalled()
  })

  it('retries an undersized response once and returns a valid replacement', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(providerResponse({ passage: 'Too short.' }))
      .mockResolvedValueOnce(providerResponse({ passage: validPassage }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await handlePassage(request('Harbors'), key())
    expect(result.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each<Duration>([30, 180])('rejects twice-oversized responses for %i seconds', async duration => {
    const { maxChars } = PASSAGE_LIMITS[duration]
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementation(async () => providerResponse({ passage: 'a'.repeat(maxChars + 1) }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await handlePassage(request('Harbors', duration), key())
    expect(result.status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('handles a provider failure without exposing the response or credentials', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('internal provider details', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await handlePassage(request('Harbors'), key())
    expect(result.status).toBe(502)
    expect(await result.text()).not.toMatch(/internal provider details|test-secret/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns unavailable when neither Workers AI nor an OpenAI key is configured', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const result = await handlePassage(request('Harbors'), key(), {})
    expect(result.status).toBe(503)
    expect(await result.json()).toEqual({
      error: 'AI passage generation is unavailable right now. Try free passages or check Settings.',
    })
  })

  it('uses a personal credential for one request and never returns it', async () => {
    const token = 'sk-test-browser-only-example'
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(providerResponse({ passage: validPassage }))
    vi.stubGlobal('fetch', fetchMock)
    const personal = request('Harbors')
    personal.headers.set('Authorization', `Bearer ${token}`)
    const response = await handlePassage(personal, key())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expectedSuccessPayload(validPassage, 'gpt-6-luna', 'openai', 0))
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${token}` })

    await handlePassage(request('Harbors'), key())
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer test-secret' })
  })

  it('rejects malformed credentials and hides provider authentication details', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('private provider details', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const personal = request('Harbors')
    personal.headers.set('Authorization', 'Bearer invalid')
    expect((await handlePassage(personal, key())).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()

    // A request body can be read once, so the second attempt needs a fresh request.
    const wellFormed = request('Harbors')
    wellFormed.headers.set('Authorization', 'Bearer sk-test-browser-only-example')
    const response = await handlePassage(wellFormed, key())
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'OpenAI rejected your key or its permissions. Check Settings.' })
  })

  it('aborts a timed-out request and releases the client and quota slots', async () => {
    vi.useFakeTimers()
    const { start, fetchMock } = mockSlowProvider()
    const pending = handlePassage(request('Harbors'), key())
    await start
    await vi.advanceTimersByTimeAsync(35_000)
    expect((await pending).status).toBe(504)

    fetchMock.mockResolvedValueOnce(providerResponse({ passage: validPassage }))
    const retryRes = await handlePassage(request('Harbors'), key())
    expect(retryRes.status).toBe(200)
    expect(await retryRes.json()).toEqual(expectedSuccessPayload(validPassage, 'gpt-6-luna', 'shared', 1))
  })

  it('rejects overlapping requests and stops work when the client disconnects', async () => {
    const controller = new AbortController()
    const { start, fetchMock } = mockSlowProvider()
    const pending = handlePassage(request('Harbors', 30, controller.signal), key())
    await start
    expect((await handlePassage(request('Harbors'), key())).status).toBe(429)
    controller.abort()
    expect((await pending).status).toBe(499)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rate limits repeated valid requests from one client via in-memory fallback', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementation(async () => providerResponse({ passage: validPassage }))
    vi.stubGlobal('fetch', fetchMock)
    const makeByokReq = () => {
      const req = request('Harbors')
      req.headers.set('Authorization', 'Bearer sk-test-browser-only-example')
      return req
    }
    for (let i = 0; i < 8; i += 1) {
      expect((await handlePassage(makeByokReq(), key())).status).toBe(200)
    }
    const result = await handlePassage(makeByokReq(), key())
    expect(result.status).toBe(429)
    expect(result.headers.get('retry-after')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(8)
  })
})

describe('5/day shared quota & Asia/Kolkata midnight rollover', () => {
  const key = () => `quota-${clientId}`

  it('computes the current day and next midnight in Asia/Kolkata (+05:30)', () => {
    // 2026-11-04 23:59:59.999 IST == 2026-11-04 18:29:59.999 UTC
    const beforeMidnightIst = new Date('2026-11-04T18:29:59.999Z')
    expect(currentKolkataDay(beforeMidnightIst)).toBe('2026-11-04')
    expect(nextKolkataMidnightIso(beforeMidnightIst)).toBe('2026-11-04T18:30:00.000Z')

    // 2026-11-05 00:00:00.000 IST == 2026-11-04 18:30:00.000 UTC
    const atMidnightIst = new Date('2026-11-04T18:30:00.000Z')
    expect(currentKolkataDay(atMidnightIst)).toBe('2026-11-05')
    expect(nextKolkataMidnightIso(atMidnightIst)).toBe('2026-11-05T18:30:00.000Z')
  })

  it('signs and verifies the superr_visitor cookie with HMAC-SHA256 and rejects tampered cookies', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const signed = await signVisitorId(id, { VISITOR_COOKIE_SECRET: 'secret-1' })
    expect(await verifyVisitorCookieValue(signed, { VISITOR_COOKIE_SECRET: 'secret-1' })).toBe(id)
    expect(await verifyVisitorCookieValue(signed, { VISITOR_COOKIE_SECRET: 'secret-2' })).toBeNull()
    expect(await verifyVisitorCookieValue(`${id}.tamperedSignatureValue`, { VISITOR_COOKIE_SECRET: 'secret-1' })).toBeNull()
    expect(await verifyVisitorCookieValue('not-a-uuid.signature', { VISITOR_COOKIE_SECRET: 'secret-1' })).toBeNull()
  })

  it('allows exactly 5 shared generations per day, blocks the 6th with 429 DAILY_QUOTA_EXHAUSTED, and resets at Asia/Kolkata midnight', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T10:00:00.000Z'))
    vi.stubEnv('OPENAI_API_KEY', '')

    const run = vi.fn().mockResolvedValue({ response: { passage: validPassage } })
    const env: PassageEnv = { AI: { run } }

    for (let i = 1; i <= 5; i += 1) {
      const res = await handlePassage(request('Harbors', 30), key(), env)
      expect(res.status).toBe(200)
      const body = (await res.json()) as PassageSuccessPayload
      expect(body.quota).toEqual({
        limit: 5,
        used: i,
        remaining: 5 - i,
        resetsAt: '2026-11-04T18:30:00.000Z',
      })
    }

    const sixth = await handlePassage(request('Harbors', 30), key(), env)
    expect(sixth.status).toBe(429)
    expect(await sixth.json()).toEqual({
      error: "You've used your 5 free generations for today. Use Free passages anytime, or connect your own API key in Settings.",
      code: 'DAILY_QUOTA_EXHAUSTED',
      quota: {
        limit: 5,
        used: 5,
        remaining: 0,
        resetsAt: '2026-11-04T18:30:00.000Z',
      },
    })
    // Provider must not be called on the 6th request.
    expect(run).toHaveBeenCalledTimes(5)

    // Advance past midnight Asia/Kolkata (18:30 UTC) and past the 60s rate-limit window
    vi.setSystemTime(new Date('2026-11-04T18:31:00.000Z'))
    const nextDayRes = await handlePassage(request('Harbors', 30), key(), env)
    expect(nextDayRes.status).toBe(200)
    const nextDayBody = (await nextDayRes.json()) as PassageSuccessPayload
    expect(nextDayBody.quota).toEqual({
      limit: 5,
      used: 1,
      remaining: 4,
      resetsAt: '2026-11-05T18:30:00.000Z',
    })
    expect(run).toHaveBeenCalledTimes(6)
  })

  it('tracks quota across requests using the signed superr_visitor cookie and returns status on GET /api/quota', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const run = vi.fn().mockResolvedValue({ response: { passage: validPassage } })
    const env: PassageEnv = { AI: { run } }

    const initialQuotaRes = await handleQuota(new Request('https://typeeng.example/api/quota'), key(), env)
    expect(initialQuotaRes.status).toBe(200)
    const setCookie = initialQuotaRes.headers.get('set-cookie')
    expect(setCookie).toMatch(/^superr_visitor=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=31536000; Secure$/)
    const cookiePair = setCookie!.split(';')[0]!
    expect(await initialQuotaRes.json()).toEqual({
      limit: 5,
      used: 0,
      remaining: 5,
      resetsAt: expect.any(String),
      timeZone: QUOTA_TIME_ZONE,
    })

    // Generate using the cookie from a different IP
    const genReq = request('Harbors', 30)
    genReq.headers.set('Cookie', cookiePair)
    const genRes = await handlePassage(genReq, `different-ip-${clientId}`, env)
    expect(genRes.status).toBe(200)
    expect(genRes.headers.get('set-cookie')).toBeNull()

    const afterQuotaReq = new Request('https://typeeng.example/api/quota', {
      headers: { Cookie: cookiePair },
    })
    const afterQuotaRes = await handleQuota(afterQuotaReq, `another-ip-${clientId}`, env)
    expect(await afterQuotaRes.json()).toMatchObject({
      limit: 5,
      used: 1,
      remaining: 4,
      timeZone: QUOTA_TIME_ZONE,
    })
  })

  it('enforces the 5-generation cap atomically across concurrent requests with the same visitor cookie', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const run = vi.fn().mockImplementation(
      async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return { response: { passage: validPassage } }
      },
    )
    const env: PassageEnv = { AI: { run } }
    const signedCookie = await signVisitorId('123e4567-e89b-42d3-a456-426614174000', env)

    const concurrentRequests = Array.from({ length: 7 }, (_, index) => {
      const req = request('Harbors', 30)
      req.headers.set('Cookie', `superr_visitor=${signedCookie}`)
      return handlePassage(req, `concurrent-ip-${index}-${clientId}`, env)
    })

    const results = await Promise.all(concurrentRequests)
    const statuses = results.map(res => res.status).sort()
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429])
    expect(run).toHaveBeenCalledTimes(5)
  })

  it('persists quota atomically through DailyQuotaDurableObject when QUOTA_DO is bound', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const storageMap = new Map<string, unknown>()
    const storage: QuotaStorageLike = {
      async get<T>(k: string) {
        return storageMap.get(k) as T | undefined
      },
      async put<T>(k: string, v: T) {
        storageMap.set(k, structuredClone(v))
      },
    }
    const doInstance = new DailyQuotaDurableObject({ storage })
    const fakeDoId: DurableObjectId = {
      toString: () => 'quota-do-id',
      equals: () => true,
    }
    const env: PassageEnv = {
      AI: { run: vi.fn().mockResolvedValue({ response: { passage: validPassage } }) },
      QUOTA_DO: {
        idFromName: () => fakeDoId,
        get: () => ({
          fetch: (input, init) => doInstance.fetch(new Request(input, init)),
        }),
      },
    }

    const first = await handlePassage(request('Harbors', 30), key(), env)
    expect(first.status).toBe(200)
    expect(((await first.json()) as PassageSuccessPayload).quota).toMatchObject({ limit: 5, used: 1, remaining: 4 })

    const second = await handlePassage(request('Harbors', 30), key(), env)
    expect(second.status).toBe(200)
    expect(((await second.json()) as PassageSuccessPayload).quota).toMatchObject({ limit: 5, used: 2, remaining: 3 })
  })
})

describe('10-provider BYOK adapter system', () => {
  const key = () => `byok-${clientId}`

  const providerTestCases: Array<{
    id: AiProviderId
    apiKey: string
    accountId?: string
    expectedUrl: (model: string) => string
    expectedHeader: Record<string, string>
    mockResponse: unknown
  }> = [
    {
      id: 'google',
      apiKey: 'AIzaSyTestKey1234567890',
      expectedUrl: model => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      expectedHeader: { 'x-goog-api-key': 'AIzaSyTestKey1234567890' },
      mockResponse: {
        candidates: [{ content: { parts: [{ text: JSON.stringify({ passage: validPassage }) }] } }],
      },
    },
    {
      id: 'openai',
      apiKey: 'sk-openai-test-key-12345',
      expectedUrl: () => 'https://api.openai.com/v1/chat/completions',
      expectedHeader: { Authorization: 'Bearer sk-openai-test-key-12345' },
      mockResponse: {
        choices: [{ message: { content: JSON.stringify({ passage: validPassage }) } }],
      },
    },
    {
      id: 'anthropic',
      apiKey: 'sk-ant-api03-testkey12345',
      expectedUrl: () => 'https://api.anthropic.com/v1/messages',
      expectedHeader: {
        'x-api-key': 'sk-ant-api03-testkey12345',
        'anthropic-version': '2023-06-01',
      },
      mockResponse: {
        content: [{ type: 'text', text: JSON.stringify({ passage: validPassage }) }],
      },
    },
    {
      id: 'openrouter',
      apiKey: 'sk-or-v1-testkey123456',
      expectedUrl: () => 'https://openrouter.ai/api/v1/chat/completions',
      expectedHeader: { Authorization: 'Bearer sk-or-v1-testkey123456' },
      mockResponse: {
        choices: [{ message: { content: JSON.stringify({ passage: validPassage }) } }],
      },
    },
    {
      id: 'groq',
      apiKey: 'gsk_testkey1234567890',
      expectedUrl: () => 'https://api.groq.com/openai/v1/chat/completions',
      expectedHeader: { Authorization: 'Bearer gsk_testkey1234567890' },
      mockResponse: {
        choices: [{ message: { content: JSON.stringify({ passage: validPassage }) } }],
      },
    },
    {
      id: 'mistral',
      apiKey: 'mistral-test-key-12345',
      expectedUrl: () => 'https://api.mistral.ai/v1/chat/completions',
      expectedHeader: { Authorization: 'Bearer mistral-test-key-12345' },
      mockResponse: {
        choices: [{ message: { content: JSON.stringify({ passage: validPassage }) } }],
      },
    },
    {
      id: 'deepseek',
      apiKey: 'sk-deepseek-test-key-123',
      expectedUrl: () => 'https://api.deepseek.com/chat/completions',
      expectedHeader: { Authorization: 'Bearer sk-deepseek-test-key-123' },
      mockResponse: {
        choices: [{ message: { content: JSON.stringify({ passage: validPassage }) } }],
      },
    },
    {
      id: 'together',
      apiKey: 'tgp_v1_testkey12345678',
      expectedUrl: () => 'https://api.together.xyz/v1/chat/completions',
      expectedHeader: { Authorization: 'Bearer tgp_v1_testkey12345678' },
      mockResponse: {
        choices: [{ message: { content: JSON.stringify({ passage: validPassage }) } }],
      },
    },
    {
      id: 'fireworks',
      apiKey: 'fw_testkey1234567890',
      expectedUrl: () => 'https://api.fireworks.ai/inference/v1/chat/completions',
      expectedHeader: { Authorization: 'Bearer fw_testkey1234567890' },
      mockResponse: {
        choices: [{ message: { content: JSON.stringify({ passage: validPassage }) } }],
      },
    },
    {
      id: 'cloudflare',
      apiKey: 'cfut_testkey1234567890',
      accountId: '0123456789abcdef0123456789abcdef',
      expectedUrl: model =>
        `https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run/${model}`,
      expectedHeader: { Authorization: 'Bearer cfut_testkey1234567890' },
      mockResponse: {
        success: true,
        result: { response: JSON.stringify({ passage: validPassage }) },
      },
    },
  ]

  it.each(providerTestCases)(
    'generates a passage with BYOK provider $id without consuming shared quota',
    async ({ id, apiKey, accountId, expectedUrl, expectedHeader, mockResponse }) => {
      vi.stubEnv('OPENAI_API_KEY', '')
      const spec = AI_PROVIDERS.find(item => item.id === id)!
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(mockResponse))
      vi.stubGlobal('fetch', fetchMock)

      const sharedRun = vi.fn()
      const env: PassageEnv = { AI: { run: sharedRun } }

      const req = request('Harbors', 30, undefined, undefined, {
        provider: {
          id,
          apiKey,
          model: spec.defaultModel,
          ...(accountId ? { accountId } : {}),
        },
      })

      const res = await handlePassage(req, `${key()}-${id}`, env)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual(expectedSuccessPayload(validPassage, spec.defaultModel, id, 0))
      expect(JSON.stringify(body)).not.toContain(apiKey)
      expect(sharedRun).not.toHaveBeenCalled()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? []
      expect(calledUrl).toBe(expectedUrl(spec.defaultModel))
      expect(calledInit?.headers).toMatchObject(expectedHeader)
    },
  )

  it('allows BYOK generation even after the visitor has exhausted all 5 free daily generations', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const sharedRun = vi.fn().mockResolvedValue({ response: { passage: validPassage } })
    const env: PassageEnv = { AI: { run: sharedRun } }
    const client = key()

    for (let i = 0; i < 5; i += 1) {
      expect((await handlePassage(request('Harbors', 30), client, env)).status).toBe(200)
    }
    expect((await handlePassage(request('Harbors', 30), client, env)).status).toBe(429)

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ passage: validPassage }) }] } }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const byokReq = request('Harbors', 30, undefined, undefined, {
      provider: {
        id: 'google',
        apiKey: 'AIzaSyTestKey1234567890',
        model: 'gemini-2.5-flash',
      },
    })
    const byokRes = await handlePassage(byokReq, client, env)
    expect(byokRes.status).toBe(200)
    expect(await byokRes.json()).toEqual(
      expectedSuccessPayload(validPassage, 'gemini-2.5-flash', 'google', 5),
    )
  })

  it('returns 401 with provider-specific actionable message when a BYOK key is rejected', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('invalid x-api-key', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    const byokReq = request('Harbors', 30, undefined, undefined, {
      provider: {
        id: 'anthropic',
        apiKey: 'sk-ant-api03-invalidkey12345',
        model: 'claude-3-5-haiku-latest',
      },
    })
    const res = await handlePassage(byokReq, key())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: 'Anthropic Claude rejected your API key or its permissions. Check Settings.',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid BYOK configurations with 400 before making any network calls', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)

    // Missing accountId for cloudflare
    const missingAccountReq = request('Harbors', 30, undefined, undefined, {
      provider: {
        id: 'cloudflare',
        apiKey: 'cfut_testkey1234567890',
      },
    })
    const res1 = await handlePassage(missingAccountReq, key())
    expect(res1.status).toBe(400)
    expect(await res1.json()).toEqual({
      error: 'Check your API key and provider configuration in Settings.',
    })

    // Invalid model for provider
    const badModelReq = request('Harbors', 30, undefined, undefined, {
      provider: {
        id: 'google',
        apiKey: 'AIzaSyTestKey1234567890',
        model: 'non-existent-model',
      },
    })
    expect((await handlePassage(badModelReq, key())).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Worker entrypoint & health endpoint', () => {
  it('returns 200 on GET /api/health without invoking env.AI.run (0 Neurons consumed)', async () => {
    const run = vi.fn()
    const env: PassageEnv = { AI: { run } }
    const req = new Request('https://typeeng.example/api/health', { method: 'GET' })

    const response = await worker.fetch(req, env)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      status: 'ok',
      provider: 'cloudflare-workers-ai',
      model: '@cf/google/gemma-4-26b-a4b-it',
      aiAvailable: true,
      quota: {
        limit: 5,
        used: 0,
        remaining: 5,
        resetsAt: expect.any(String),
      },
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects POST on /api/health with 405', () => {
    const req = new Request('https://typeeng.example/api/health', { method: 'POST' })
    const response = handleHealth(req)
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS')
  })

  it('routes POST /api/generate-passage, legacy POST /api/passage, and GET /api/quota through the Worker', async () => {
    const run = vi.fn().mockResolvedValue({ response: { passage: validPassage } })
    const env: PassageEnv = { AI: { run } }

    const primaryReq = new Request('https://typeeng.example/api/generate-passage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': `worker-primary-${clientId}`,
      },
      body: JSON.stringify({ topic: 'Harbors', duration: 30 }),
    })
    const primaryRes = await worker.fetch(primaryReq, env)
    expect(primaryRes.status).toBe(200)
    expect(await primaryRes.json()).toEqual(expectedSuccessPayload(validPassage, MODEL_ID))

    const legacyReq = new Request('https://typeeng.example/api/passage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': `worker-legacy-${clientId}`,
      },
      body: JSON.stringify({ topic: 'Harbors', duration: 30 }),
    })
    const legacyRes = await handleWorkerRequest(legacyReq, env)
    expect(legacyRes.status).toBe(200)

    const quotaReq = new Request('https://typeeng.example/api/quota', {
      method: 'GET',
      headers: { 'CF-Connecting-IP': `worker-primary-${clientId}` },
    })
    const quotaRes = await worker.fetch(quotaReq, env)
    expect(quotaRes.status).toBe(200)
    expect(await quotaRes.json()).toEqual({
      limit: 5,
      used: 1,
      remaining: 4,
      resetsAt: expect.any(String),
      timeZone: QUOTA_TIME_ZONE,
    })
  })

  it('returns 404 for unknown Worker routes', async () => {
    const response = await handleWorkerRequest(new Request('https://typeeng.example/api/unknown'))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found.' })
  })

  it('supports wildcard subdomain entries in ALLOWED_ORIGINS for Vercel deployments', () => {
    const req = new Request('https://superr-typeeng.superr-typeeng.workers.dev/api/generate-passage')
    const env = { ALLOWED_ORIGINS: 'https://*.vercel.app,https://superr-typeeng.superr-typeeng.workers.dev' }
    expect(isAllowedOrigin('https://superr-typeeng.vercel.app', req, env)).toBe(true)
    expect(isAllowedOrigin('https://superr-typeeng-git-main-sarthaksaini041.vercel.app', req, env)).toBe(true)
    expect(isAllowedOrigin('https://evil-vercel.app', req, env)).toBe(false)
    expect(isAllowedOrigin('https://vercel.app.attacker.com', req, env)).toBe(false)
  })
})
