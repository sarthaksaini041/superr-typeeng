# superr-typeeng agent instructions

## Architecture

- Use Vite and strict TypeScript with React for the single-page client. Keep the server-side passage endpoint separate from client code and reuse the duration, grapheme, sample catalog, and BYOK provider definitions in `src/shared`.
- Keep typing and timing logic in `src/typing`, interface components in `src/ui`, provider integration, quota management, and system prompts in `server` (`server/passage.ts`, `server/providers.ts`, `server/quota.ts`, and `server/system-prompt.ts`), and the Cloudflare Worker entrypoint, bindings, and `DailyQuotaDurableObject` export in `workers/ai` (`workers/ai/index.ts` and `workers/ai/env.ts`). Keep generation request orchestration in the app layer (`src/App.tsx`).
- Build focused, typed, reusable components. Extract domain logic from rendering and reuse recurring interface patterns. Avoid speculative abstractions and unnecessary dependencies.
- Keep state local. Model generation and typing transitions explicitly. Guard request and session identities against stale asynchronous work. Use a single monotonic deadline and idempotent finalization. Clean up listeners, timers, frames, and requests.
- Use the same grapheme segmentation for validation and input. Compare exact characters. Count all printable insertion attempts historically, including errors later corrected.
- The typing passage always displays the original generated passage (`word.expected`) and never substitutes or renders the actual characters typed by the user; reflect correctness and mistakes strictly through state classes (`typing-char--correct`, `typing-char--wrong`, `typing-char--missed`, `typing-char--pending`).
- Submit words with Space. Keep separators and punctuation intact, record omissions separately from insertion attempts, and let Backspace reopen a word with unresolved errors.

## Cloudflare Workers AI, Daily Quota & BYOK Conventions

- **Default Shared Model:** Use `@cf/google/gemma-4-26b-a4b-it` via the Cloudflare Workers AI binding (`env.AI.run`) as the primary server-side passage generator, with optional override via `env.AI_MODEL`.
- **Non-Thinking Mode:** Always pass `chat_template_kwargs: { enable_thinking: false }` alongside `response_format` (`json_schema` for `{"passage": string}`) and duration-scaled `max_tokens` (`>= 1600` for `180s`) so token budget and latency go exclusively toward the passage text.
- **Worker Bindings:** Configure `AI` (Workers AI binding), `QUOTA_DO` (`DailyQuotaDurableObject` binding), and `PASSAGE_RATE_LIMITER` (Cloudflare Rate Limiting binding) in `wrangler.jsonc` and type them in `workers/ai/env.ts`. Fall back to the in-memory quota store, in-memory rate limiter, and optional `OPENAI_API_KEY` when running outside Workers.
- **5/Day Shared AI Quota (`Asia/Kolkata` Midnight Reset):**
  - Enforce a strict 5-generation daily limit per visitor in `server/quota.ts` using `DailyQuotaDurableObject` (with in-memory fallback in local/test environments) and an HMAC-SHA256 signed `superr_visitor` `HttpOnly` cookie (`VISITOR_COOKIE_SECRET`) paired with client IP fallback.
  - Reset daily quotas at midnight `Asia/Kolkata` (`+05:30`). Reserve a slot before invoking shared AI, commit only when a valid passage is returned, and release the reservation on provider/validation failure or cancellation so failed generations and restarts never consume quota.
- **10-Provider Bring Your Own Key (BYOK):**
  - Support 10 providers defined in `src/shared/personal-key.ts` and dispatched in `server/providers.ts`: Google Gemini (`google`), OpenAI (`openai`), Anthropic Claude (`anthropic`), OpenRouter (`openrouter`), Groq (`groq`), Mistral AI (`mistral`), DeepSeek (`deepseek`), Together AI (`together`), Fireworks AI (`fireworks`), and Cloudflare Workers AI REST (`cloudflare`, requiring `accountId`).
  - BYOK requests bypass the shared 5/day quota and never fall back silently to shared server AI credentials when a user-supplied key fails authentication (`401`) or provider rate limits (`429`).
- **API Endpoints:**
  - `POST /api/generate-passage` (and legacy alias `POST /api/passage`): Validates `{ topic, duration, provider? }`, invokes shared Workers AI (or OpenAI fallback) or the user's selected BYOK provider, and returns `{ passage, model, provider, wordCount, characterCount, quota }` with `Cache-Control: no-store`.
  - `GET /api/quota`: Returns `{ limit, used, remaining, resetsAt, timeZone: 'Asia/Kolkata' }` with `Cache-Control: no-store` and sets the signed `superr_visitor` cookie when absent.
  - `GET /api/health`: Returns `{ status: 'ok', provider: 'cloudflare-workers-ai', model, aiAvailable, quota }` without invoking `env.AI.run` (0 Neurons consumed).
- **System Prompt & Validation:** Keep the prompt in `server/system-prompt.ts`. Treat the user's topic as untrusted data. Normalize layout whitespace in `validatePassage`, reject Markdown/lists/headings/code fences/HTML/surrounding quotes/control characters, and enforce the exact grapheme bounds from `PASSAGE_LIMITS` (`30s`: 600–900, `45s`: 900–1250, `60s`: 1200–1650, `90s`: 1800–2300, `120s`: 2400–3000, `180s`: 3600–4000). Allow at most one retry on invalid model output, and never retry on `429` quota/rate-limit or `401`/`403` authentication errors.

## Cost Control (Cloudflare Free Tier — 10,000 Neurons/day) & Free Passages Catalog

- Call the AI endpoint only on explicit user submission (`Generate passage` button or `Enter` in the topic input). Never prefetch, auto-generate on keystrokes, or invoke AI from `src/typing`.
- **Restart** must reuse the current session's `passage`, `topic`, and `duration` in memory without making another network request or consuming daily quota.
- **Free Passages Selection Dialog & Catalog (`src/shared/sample-catalog.ts`):**
  - Keep **Free passages** (`FreePassagesDialog` in `src/ui/index.tsx` and catalog helpers in `src/shared/sample-catalog.ts`) working completely offline with zero AI requests and zero quota consumption, even when the 5/day shared quota is exhausted.
  - Provide 100 curated passages organized across 5 concrete categories (`Everyday & Modern`, `Science Fiction`, `Mystery & Adventure`, `Gothic & Speculative`, `Classic Fiction`, plus `All`), with duration-aware truncation (`sampleForDuration`), word/character counts, previews, and instant selection or `Random passage`.
- Mock all AI calls in unit tests (`server/passage.test.ts`) and intercept `**/api/generate-passage` in Playwright E2E tests (`e2e/application.spec.ts`) so automated test runs consume 0 Cloudflare Neurons.

## Interface

- Use shared CSS tokens for typography, color, spacing, radius, and transitions. Use scoped classes and responsive layouts. Avoid arbitrary inline styles, global patches, and `!important`.
- Keep the black and red visual identity understated. Use Hugeicons consistently. Give controls accessible names and visible focus. Honor reduced motion and provide cues beyond color.
- Support touch, physical keyboards, and input composition. Keep the current passage text visible and defer rendering distant text.
- Position one caret with transforms, follow the latest target in a single animation frame, and keep the timer outside the scrolling passage.

## Security and code quality

- Keep provider credentials and Cloudflare bindings server-side. Validate bounded requests (`<= 4096` bytes, `1–200` graphemes, `<= 600` code units) and structured provider responses. Enforce duration-specific output limits, request deadlines (`35s` server, `45s` client), concurrency caps, and rate limiting (`PASSAGE_RATE_LIMITER` and per-IP fallback).
- Enforce origin checks (`ALLOWED_ORIGINS` and same-origin/localhost validation), `sec-fetch-site` cross-site protection, and optional Cloudflare Turnstile verification (`TURNSTILE_SECRET_KEY`).
- **BYOK Credential Security:** Keep user-supplied API keys in memory only (`src/personal-key-storage.ts`) for the active browser tab session. Actively scrub any legacy Web Storage entries (`superr-typeeng.openai-key`), and never persist API keys in `localStorage`, `sessionStorage`, `IndexedDB`, cookies, or server logs. Mask configured keys in the UI (`maskApiKey`) and forward credentials only for a single generation request.
- Configure public client variables in `.env.example` (`VITE_API_BASE_URL`, `VITE_TURNSTILE_SITE_KEY`, `WORKER_DEV_URL`) and Worker secrets/overrides in `.dev.vars.example` (`TURNSTILE_SECRET_KEY`, `VISITOR_COOKIE_SECRET`, `ALLOWED_ORIGINS`, `AI_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`). Never expose secrets in `VITE_*` variables.
- Render AI content as text. Treat the topic and provider output as untrusted. Never log topics or secrets by default. Keep user-facing errors actionable and free of provider internals.
- Use meaningful names and explicit error handling. Avoid `any` unless justified in code. Keep rendering inexpensive per keystroke and avoid unrelated renders.
- Use descriptive tests for grapheme comparisons, backspace and historical metrics, timing races, stale sessions, validation, retries, daily quota, multi-provider BYOK, and user flows. Run lint, type-check, tests, and production build. Check responsive layouts and keyboard interactions in a browser when available.

