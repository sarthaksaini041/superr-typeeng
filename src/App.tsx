import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { DURATIONS, isDuration, PASSAGE_LIMITS, splitGraphemes } from './shared/passage'
import type { Duration } from './shared/passage'
import { DAILY_FREE_GENERATION_LIMIT, type ByokConfig } from './shared/personal-key'
import { chooseSample } from './shared/sample-catalog'
import { readByokConfig } from './personal-key-storage'
import { TypingTest } from './typing'
import type { TypingResult } from './typing'
import {
  Brand,
  CapsLock,
  chooseRandomTopic,
  ErrorNotification,
  FreePassagesDialog,
  Results,
  SessionFrame,
  SettingsDialog,
  Setup,
} from './ui'

const preferenceKey = 'superr-typeeng.duration'
const quotaExhaustedMessage =
  "You've used your 5 free generations for today. Use Free passages anytime, or connect your own API key in Settings."

function passageEndpoint(): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '')
  return baseUrl ? `${baseUrl}/api/generate-passage` : '/api/generate-passage'
}

function quotaEndpoint(): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '')
  return baseUrl ? `${baseUrl}/api/quota` : '/api/quota'
}

function generationErrorMessage(status: number, error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error
  if (status === 429) return 'Too many requests. Wait a moment or try free passages.'
  if (status === 503) return 'Passage generation is temporarily unavailable. Try again or use free passages.'
  return 'Could not generate a passage. Try again.'
}

function preferredDuration(): Duration {
  try {
    const saved = Number(localStorage.getItem(preferenceKey))
    if (isDuration(saved)) return saved
  } catch {
    // Storage may be unavailable in private or embedded browsing contexts.
  }
  return DURATIONS[0]
}

type Session = { id: number; topic: string; passage: string; duration: Duration }
type View =
  | { phase: 'idle' | 'generating' }
  | { phase: 'error'; error: string; quotaExhausted?: boolean }
  | { phase: 'ready' | 'running'; session: Session }
  | { phase: 'completed'; session: Session; result: TypingResult }

export function App() {
  const [view, setView] = useState<View>({ phase: 'idle' })
  const [topic, setTopic] = useState('')
  const [duration, setDuration] = useState(preferredDuration)
  const [remaining, setRemaining] = useState<number>(duration)
  const [capsLock, setCapsLock] = useState(false)
  const [diceVersion, setDiceVersion] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [passagesOpen, setPassagesOpen] = useState(false)
  const [remainingQuota, setRemainingQuota] = useState<number>(DAILY_FREE_GENERATION_LIMIT)
  const [byokConfig, setByokConfig] = useState<ByokConfig | null>(() => readByokConfig())
  const generation = useRef<AbortController | null>(null)
  const nextSession = useRef(0)
  const previousDice = useRef('')
  const previousSample = useRef<number | null>(null)

  useEffect(() => () => generation.current?.abort(), [])

  useEffect(() => {
    const controller = new AbortController()
    fetch(quotaEndpoint(), {
      method: 'GET',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(response => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        if (
          data &&
          typeof data === 'object' &&
          'remaining' in data &&
          typeof (data as { remaining?: unknown }).remaining === 'number' &&
          !controller.signal.aborted
        ) {
          setRemainingQuota(Math.max(0, (data as { remaining: number }).remaining))
        }
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  function selectDuration(value: Duration) {
    if (view.phase === 'running' || generation.current) return
    setDuration(value)
    try {
      localStorage.setItem(preferenceKey, String(value))
    } catch {
      // The preference still applies for the current page.
    }
  }

  function startSession(passage: string, subject: string, length: Duration) {
    setRemaining(length)
    setCapsLock(false)
    setView({ phase: 'ready', session: { id: ++nextSession.current, passage, topic: subject, duration: length } })
  }

  async function generate() {
    const subject = topic.trim()
    if (!subject || generation.current) return

    const activeByok = byokConfig ?? readByokConfig()
    if (!activeByok && remainingQuota <= 0) {
      setView({
        phase: 'error',
        error: quotaExhaustedMessage,
        quotaExhausted: true,
      })
      return
    }

    const controller = new AbortController()
    generation.current = controller
    const timeout = AbortSignal.timeout(45_000)
    setView({ phase: 'generating' })
    try {
      const headers = new Headers({ 'Content-Type': 'application/json' })
      const requestBody: Record<string, unknown> = { topic: subject, duration }
      if (activeByok) {
        requestBody.provider = {
          id: activeByok.provider,
          apiKey: activeByok.apiKey,
          model: activeByok.model,
          ...(activeByok.accountId ? { accountId: activeByok.accountId } : {}),
        }
      }
      const response = await fetch(passageEndpoint(), {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        redirect: 'error',
        body: JSON.stringify(requestBody),
        signal: AbortSignal.any([controller.signal, timeout]),
      })
      let data: {
        passage?: unknown
        error?: unknown
        code?: unknown
        quota?: { remaining?: unknown }
      } = {}
      try {
        data = await response.json()
      } catch (error) {
        if (controller.signal.aborted || timeout.aborted || response.ok) throw error
      }
      if (generation.current !== controller) return
      if (data.quota && typeof data.quota.remaining === 'number') {
        setRemainingQuota(Math.max(0, data.quota.remaining))
      } else if (response.status === 429 && data.code === 'DAILY_QUOTA_EXHAUSTED') {
        setRemainingQuota(0)
      }
      if (!response.ok) {
        const isQuotaExhausted =
          data.code === 'DAILY_QUOTA_EXHAUSTED' ||
          (data.quota && typeof data.quota.remaining === 'number' && data.quota.remaining <= 0)
        setView({
          phase: 'error',
          error: generationErrorMessage(response.status, data.error),
          quotaExhausted: Boolean(isQuotaExhausted),
        })
        return
      }
      const passage = data.passage
      const limits = PASSAGE_LIMITS[duration]
      const length = typeof passage === 'string' ? splitGraphemes(passage).length : 0
      if (typeof passage !== 'string' || length < limits.minChars || length > limits.maxChars) {
        setView({ phase: 'error', error: 'The passage was incomplete. Try again.' })
        return
      }
      if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const transition = document.startViewTransition(() => {
          if (generation.current === controller) {
            flushSync(() => startSession(passage, subject, duration))
          }
        })
        await transition.updateCallbackDone
      } else {
        startSession(passage, subject, duration)
      }
    } catch {
      if (generation.current === controller) {
        setView({
          phase: 'error',
          error: timeout.aborted ? 'Generation took too long. Try again.' : 'Could not connect. Try again.',
        })
      }
    } finally {
      if (generation.current === controller) generation.current = null
    }
  }

  function startRandomSample() {
    if (generation.current) return
    const sample = chooseSample(duration, previousSample.current)
    previousSample.current = sample.index
    setPassagesOpen(false)
    startSession(sample.passage, sample.title, duration)
  }

  function cancelGeneration() {
    generation.current?.abort()
    generation.current = null
    setView({ phase: 'idle' })
  }

  function newTopic() {
    cancelGeneration()
    setCapsLock(false)
    setTopic('')
  }

  const session = 'session' in view ? view.session : undefined
  const setup = view.phase === 'idle' || view.phase === 'generating' || view.phase === 'error'
  const restart = () => {
    if (session) startSession(session.passage, session.topic, session.duration)
  }

  return (
    <>
      <Brand
        diceDisabled={view.phase === 'generating'}
        diceVersion={diceVersion}
        onSettings={setup ? () => {
          if (view.phase === 'error') setView({ phase: 'idle' })
          setSettingsOpen(true)
        } : undefined}
        onDice={setup ? () => {
          const choice = chooseRandomTopic(previousDice.current || topic)
          previousDice.current = choice
          setTopic(choice)
          setDiceVersion(value => value + 1)
        } : undefined}
      />
      {setup && (
        <Setup
          status={view.phase}
          topic={topic}
          onTopicChange={setTopic}
          duration={duration}
          onDurationChange={selectDuration}
          onSubmit={generate}
          onCancel={cancelGeneration}
          onPractice={() => {
            if (view.phase === 'error') setView({ phase: 'idle' })
            setPassagesOpen(true)
          }}
          remainingQuota={remainingQuota}
          byokConfig={byokConfig}
        />
      )}
      {view.phase === 'completed' && (
        <Results {...view.result} topic={view.session.topic} onRestart={restart} onNewTopic={newTopic} />
      )}
      {(view.phase === 'ready' || view.phase === 'running') && (
        <SessionFrame
          topic={view.session.topic}
          remainingMs={remaining * 1000}
          running={view.phase === 'running'}
          onRestart={restart}
          onNewTopic={newTopic}
        >
          <TypingTest
            key={view.session.id}
            sessionId={view.session.id}
            passage={view.session.passage}
            duration={view.session.duration}
            onStart={() => setView(current => current.phase === 'ready' && current.session.id === view.session.id
              ? { ...current, phase: 'running' }
              : current)}
            onRemaining={setRemaining}
            onCapsLock={setCapsLock}
            onFinish={result => {
              setCapsLock(false)
              setView(current => (current.phase === 'running' || current.phase === 'ready') && current.session.id === view.session.id
                ? { phase: 'completed', session: current.session, result }
                : current)
            }}
          />
        </SessionFrame>
      )}
      <CapsLock active={capsLock} concealed={view.phase === 'running'} />
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          remainingQuota={remainingQuota}
          byokConfig={byokConfig}
          onSaveByok={config => {
            setByokConfig(config)
            if (config && view.phase === 'error' && view.quotaExhausted) {
              setView({ phase: 'idle' })
            }
          }}
          onOpenFreePassages={() => {
            setSettingsOpen(false)
            setPassagesOpen(true)
          }}
        />
      )}
      {passagesOpen && (
        <FreePassagesDialog
          duration={duration}
          onDurationChange={selectDuration}
          onSelectPassage={sample => {
            previousSample.current = sample.index
            setPassagesOpen(false)
            startSession(sample.passage, sample.title, sample.duration)
          }}
          onRandomPassage={startRandomSample}
          onClose={() => setPassagesOpen(false)}
        />
      )}
      {view.phase === 'error' && (
        <ErrorNotification
          message={view.error}
          onRetry={generate}
          onDismiss={cancelGeneration}
          onFreePassages={() => {
            setView({ phase: 'idle' })
            setPassagesOpen(true)
          }}
          onSettings={() => {
            setView({ phase: 'idle' })
            setSettingsOpen(true)
          }}
        />
      )}
    </>
  )
}
